(ns estorm.parser
  "Parses estorm notation (see GRAMMAR.md) into an AST.
  Errors are thrown as ex-info with {:line n} in ex-data."
  (:require [clojure.string :as str]))

(defn- fail [line msg]
  (throw (ex-info msg {:line line})))

(def ^:private name-re #"[^()\[\]{}:]+")

(defn- parse-item
  "One chain item: (Aggregate), [External] or a bare name. nil if invalid."
  [s]
  (condp re-matches s
    #"\((.+)\)" :>> (fn [[_ n]] {:type :aggregate :name (str/trim n)})
    #"\[(.+)\]" :>> (fn [[_ n]] {:type :external :name (str/trim n)})
    name-re     {:type :name :name s}
    nil))

(defn- parse-chain
  "`Command -> ... -> Event` into {:command :via :event}."
  [line s]
  (let [raw (map str/trim (str/split s #"->" -1))
        _ (when (some str/blank? raw)
            (fail line "empty item in chain"))
        [command & more] (map #(or (parse-item %) (fail line (str "invalid item: " %)))
                              raw)
        event (last more)
        via (butlast more)]
    (when-not (= :name (:type command))
      (fail line (str "expected a command, got " (first raw))))
    (when-not event
      (fail line "chain must end with an event"))
    (when-not (= :name (:type event))
      (fail line (str "chain must end with an event, got " (last raw))))
    (when-let [bad (first (remove (comp #{:aggregate :external} :type) via))]
      (fail line (str "expected (Aggregate) or [External], got " (:name bad))))
    {:command (:name command) :via (vec via) :event (:name event)}))

(defn- classify
  "One source line into a statement map with :line and :level, or nil
  for blanks and comments."
  [n raw]
  (let [indent (re-find #"^[ \t]*" raw)
        text (str/trim raw)]
    (cond
      (or (str/blank? text) (str/starts-with? text "#")) nil
      (str/includes? indent "\t") (fail n "tab in indentation")
      (odd? (count indent)) (fail n "indentation must be a multiple of 2 spaces")
      :else
      (let [stmt {:line n :level (quot (count indent) 2)}
            [_ section] (re-matches #"==\s*(.*?)\s*==" text)
            [_ read-model] (re-matches #"\{([^{}]+)\}" text)
            [_ then-rest] (re-matches #"then\s+(.+)" text)
            [_ when-event] (re-matches #"when\s+(.+)" text)
            [_ actor flow-rest] (re-matches #"([^:]+):(.*)" text)]
        (cond
          (str/starts-with? text "!")
          (let [t (str/trim (subs text 1))]
            (when (str/blank? t) (fail n "empty hotspot"))
            (assoc stmt :type :hotspot :text t))

          section
          (do (when (str/blank? section) (fail n "empty section name"))
              (when (pos? (:level stmt)) (fail n "section must not be indented"))
              (assoc stmt :type :section :name section))

          read-model
          (assoc stmt :type :read-model :name (str/trim read-model))

          when-event
          (let [event (str/trim when-event)]
            (when-not (and (re-matches name-re event) (not (str/includes? event "->")))
              (fail n (str "'when' expects an event name, got " event)))
            (assoc stmt :type :when :event event))

          then-rest
          (merge stmt {:type :reaction} (parse-chain n then-rest))

          actor
          (let [actor (str/trim actor)]
            (when-not (re-matches name-re actor)
              (fail n (str "invalid actor: " actor)))
            (merge stmt {:type :flow :actor actor} (parse-chain n flow-rest)))

          :else (fail n "unrecognised line"))))))

(defn- check-level [steps {:keys [type level line]}]
  (let [prev (:level (peek steps))]
    (case type
      :flow (when (pos? level)
              (fail line "flow must not be indented"))
      :when (when (pos? level)
              (fail line "'when' must not be indented"))
      :reaction (cond
                  (or (zero? level) (nil? prev))
                  (fail line "'then' has no parent flow")
                  (> level (inc prev))
                  (fail line "'then' must be one level deeper than its parent")))))

(defn- dangling [{:keys [line name]}]
  (fail line (str "read model {" name "} informs nothing")))

(defn- collect
  "Reducer: flat list of steps (flows, whens and reactions), top-level
  board items (hotspots and sections), and read models waiting for the
  step they inform. A hotspot goes to the latest step in its section,
  which caused it; with no such step it is top-level."
  [acc stmt]
  (case (:type stmt)
    :hotspot
    (let [hotspot (dissoc stmt :level)
          current (:current acc)]
      (cond
        (nil? current) (update acc :board conj hotspot)
        (= :when (get-in acc [:steps current :type]))
        (fail (:line stmt) "hotspot must follow a flow or reaction, not 'when'")
        :else (update-in acc [:steps current :hotspots] conj hotspot)))
    :section
    (do (some-> (first (:pending acc)) dangling)
        (-> acc
            (update :board conj (dissoc stmt :level))
            (assoc :current nil)))
    :read-model (update acc :pending conj stmt)
    :when
    (do (check-level (:steps acc) stmt)
        (-> acc
            (update :steps conj (assoc stmt :hotspots []))
            (assoc :current (count (:steps acc)))))
    (:flow :reaction)
    (do (check-level (:steps acc) stmt)
        (some->> (:pending acc)
                 (filter #(> (:level %) (:level stmt)))
                 first
                 dangling)
        (-> acc
            (update :steps conj
                    (assoc stmt
                           :informed-by (mapv #(dissoc % :level) (:pending acc))
                           :hotspots []))
            (assoc :pending []
                   :current (count (:steps acc)))))))

(defn- nest
  "Turns a flat list of steps into a tree, each step taking the deeper
  steps that follow it as :reactions."
  [steps level]
  (loop [steps steps
         acc []]
    (if-let [[step & more] (seq steps)]
      (let [[children siblings] (split-with #(> (:level %) level) more)]
        (recur siblings
               (conj acc (-> step
                             (dissoc :level)
                             (assoc :reactions (nest children (inc level)))))))
      acc)))

(defn- events
  "All events produced by TREES of steps. A 'when' produces none itself."
  [trees]
  (mapcat #(cond->> (events (:reactions %))
             (not= :when (:type %)) (cons (:event %)))
          trees))

(defn- check-whens
  "Each 'when' needs reactions and an event that some step produces."
  [trees]
  (let [known (set (events trees))]
    (doseq [{:keys [type line event reactions]} trees
            :when (= :when type)]
      (when (empty? reactions)
        (fail line "'when' has no reactions"))
      (when-not (known event)
        (fail line (str "'when' refers to unknown event " event))))))

(defn parse
  "Parses estorm text into a vector of top-level items (flows, whens,
  sections and board hotspots), in source order."
  [text]
  (let [{:keys [steps board pending]}
        (->> (str/split-lines text)
             (map-indexed (fn [i line] (classify (inc i) line)))
             (remove nil?)
             (reduce collect {:steps [] :board [] :pending [] :current nil}))
        trees (nest steps 0)]
    (some-> (first pending) dangling)
    (check-whens trees)
    (->> (concat trees board)
         (sort-by :line)
         vec)))
