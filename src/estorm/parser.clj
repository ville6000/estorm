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
            [after? duration unless] (re-matches #"after\s+(.+?)(?:\s+unless\s+(.+))?" text)
            [_ schedule schedule-rest] (re-matches #"every\s+(.+?):\s+(.*)" text)
            [_ actor flow-rest] (re-matches #"([^:]+):(.*)" text)
            check-event (fn [keyword event]
                          (when-not (and (re-matches name-re event) (not (str/includes? event "->")))
                            (fail n (str "'" keyword "' expects an event name, got " event))))]
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
            (check-event "when" event)
            (assoc stmt :type :when :event event))

          after?
          (let [unless (some-> unless str/trim)]
            (some->> unless (check-event "unless"))
            (cond-> (assoc stmt :type :after :duration (str/trim duration))
              unless (assoc :unless unless)))

          schedule
          (merge stmt {:type :flow :schedule (str/trim schedule)} (parse-chain n schedule-rest))

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
      (:reaction :after)
      (let [keyword (if (= :after type) "after" "then")]
        (cond
          (or (zero? level) (nil? prev))
          (fail line (str "'" keyword "' has no parent flow"))
          (> level (inc prev))
          (fail line (str "'" keyword "' must be one level deeper than its parent")))))))

(defn- dangling [{:keys [line name]}]
  (fail line (str "read model {" name "} informs nothing")))

(defn- collect
  "Reducer: flat list of steps (flows, whens, afters and reactions), top-level
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
        (#{:when :after} (get-in acc [:steps current :type]))
        (fail (:line stmt) (str "hotspot must follow a flow or reaction, not '"
                                (name (get-in acc [:steps current :type])) "'"))
        :else (update-in acc [:steps current :hotspots] conj hotspot)))
    :section
    (do (some-> (first (:pending acc)) dangling)
        (-> acc
            (update :board conj (dissoc stmt :level))
            (assoc :current nil)))
    :read-model (update acc :pending conj stmt)
    (:when :after)
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

(defn- produces-event? [step]
  (#{:flow :reaction} (:type step)))

(defn- events
  "All events produced by TREES of steps. 'when' and 'after' produce none
  themselves."
  [trees]
  (mapcat #(cond->> (events (:reactions %))
             (produces-event? %) (cons (:event %)))
          trees))

(defn- all-steps [trees]
  (mapcat #(cons % (all-steps (:reactions %))) trees))

(defn- check-triggers
  "Each 'when' and 'after' needs reactions, and the events they name must
  be produced by some step."
  [trees]
  (let [known (set (events trees))]
    (doseq [{:keys [type line event unless reactions]} (all-steps trees)
            :when (#{:when :after} type)
            :let [keyword (name type)]]
      (when (empty? reactions)
        (fail line (str "'" keyword "' has no reactions")))
      (when (and event (not (known event)))
        (fail line (str "'when' refers to unknown event " event)))
      (when (and unless (not (known unless)))
        (fail line (str "'unless' refers to unknown event " unless))))))

(defn parse
  "Parses estorm text into a vector of top-level items (flows, whens,
  sections and board hotspots), in source order. Flows and reactions nest
  their reactions; an 'after' sits among them, holding the reactions it
  delays."
  [text]
  (let [{:keys [steps board pending]}
        (->> (str/split-lines text)
             (map-indexed (fn [i line] (classify (inc i) line)))
             (remove nil?)
             (reduce collect {:steps [] :board [] :pending [] :current nil}))
        trees (nest steps 0)]
    (some-> (first pending) dangling)
    (check-triggers trees)
    (->> (concat trees board)
         (sort-by :line)
         vec)))
