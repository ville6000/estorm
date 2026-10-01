(ns estorm.layout
  "Places AST stickies on the board. Time runs left to right; every flow
  and reaction gets its own row, and a reaction starts under the event
  that triggered it. Sections are vertical lanes, side by side in order
  of first appearance. A 'when' reaction is linked to the event it names
  by a dashed arrow; in another lane it starts at column 0, level with
  that event if the lane is free there.")

(def sticky-w 150)
(def sticky-h 100)
(def gap-x 30)
(def gap-y 40)
(def flow-gap 40)
(def margin 20)
(def lane-label-h 36)
(def lane-pad 20)
(def lane-gap 80)

(defn- sticky
  "Sticky at lane-local X."
  [kind text line x y]
  {:kind kind :text text :line line :x x :y y :w sticky-w :h sticky-h})

(defn- col-x [col]
  (* col (+ sticky-w gap-x)))

(defn- arrow
  "Straight arrow from the right side of A to the left side of B."
  [a b]
  (let [y (+ (:y a) (* 0.5 sticky-h))]
    [[(+ (:x a) (:w a)) y] [(:x b) y]]))

(defn- branch
  "Elbow arrow from the bottom of event E into POLICY, whose row starts at
  GROUP-X (read models touch the policy on its left). A policy on the next
  row is entered straight from above; otherwise the arrow runs down a rail
  left of the row, then over the row into the top of the policy. Sibling
  reactions share the rail; OFFSET shifts the route so links run beside it."
  ([e policy group-x] (branch e policy group-x 0))
  ([e policy group-x offset]
   (let [mid-x (+ (:x e) (* 0.5 sticky-w) (* 2 offset))
         below (+ (:y e) sticky-h (* 0.5 gap-y) offset)
         above (- (:y policy) (* 0.5 gap-y) (- offset))
         px (+ (:x policy) (* 0.5 sticky-w) (* 2 offset))
         rail (- group-x (* 0.5 gap-x) offset)]
     (concat [[mid-x (+ (:y e) sticky-h)] [mid-x below]]
             (if (= below above)
               [[px below]]
               [[rail below] [rail above] [px above]])
             [[px (:y policy)]]))))

(defn- policy-text [{:keys [text after]}]
  (if-let [{:keys [duration unless]} after]
    (str "⏰ " duration " after " text (when unless (str ", unless " unless)))
    (str "whenever " text)))

(defn- chain
  "[kind text line] for each sticky of STEP's row, in time order."
  [step trigger]
  (let [line (:line step)]
    (concat (for [rm (:informed-by step)] [:read-model (:name rm) (:line rm)])
            [(cond
               trigger [:policy (policy-text trigger) line]
               (:schedule step) [:schedule (str "⏰ every " (:schedule step)) line]
               :else [:actor (:actor step) line])
             [:command (:command step) line]]
            (for [v (:via step)] [(:type v) (:name v) line])
            [[:event (:event step) line]])))

(def ^:private group-kinds
  "Kinds that touch the sticky after them: read models, actor or policy,
  and their command form one group."
  #{:read-model :actor :schedule :policy})

(defn- row-xs
  "Lane-local x of each sticky of a row of KINDS starting at X0."
  [kinds x0]
  (reductions (fn [x kind] (+ x sticky-w (if (group-kinds kind) 0 gap-x)))
              x0
              (butlast kinds)))

(defn- flow-arrows
  "Arrows between the stickies of a row, from the command on."
  [placed]
  (let [from (drop-while (comp group-kinds :kind) placed)]
    (map arrow from (rest from))))

(declare place-row)

(defn- place-step
  "Places STEP on the next free row with its actor or policy at lane-local
  X, then its reactions below it, starting under its event. TRIGGER is the
  event sticky a reaction reacts to, nil for a flow. Reactions of a 'when'
  have a trigger with :pending set: the event is placed elsewhere, so the
  link is drawn later. An 'after' has no row: it passes the trigger on to
  its reactions, delayed, and their policies get a cancel link from its
  'unless' event."
  [board step x trigger]
  (if (= :after (:type step))
    (reduce #(place-step %1 %2 x (assoc trigger :after step)) board (:reactions step))
    (place-row board step x trigger)))

(defn- place-row
  [board step x trigger]
  (let [y (:y board)
        items (chain step trigger)
        start (max 0 (- x (* sticky-w (count (:informed-by step)))))
        placed (mapv (fn [[kind text line] x] (sticky kind text line x y))
                     items
                     (row-xs (map first items) start))
        event (peek placed)
        hotspots (map-indexed (fn [i h] (sticky :hotspot (:text h) (:line h)
                                                (+ (:x event) (col-x (inc i))) y))
                              (:hotspots step))
        policy (when trigger (nth placed (count (:informed-by step))))
        unless (get-in trigger [:after :unless])
        board (cond-> (-> board
                          (update :stickies into (concat placed hotspots))
                          (update :arrows into (flow-arrows placed))
                          (update :y + sticky-h gap-y))
                trigger
                (update (if (:pending trigger) :pending-links :arrows) conj
                        (if (:pending trigger)
                          {:event (:text trigger) :policy policy :group-x start :kind :link}
                          (branch trigger policy start)))
                unless
                (update :pending-links conj
                        {:event unless :policy policy :group-x start :kind :cancel}))]
    (reduce #(place-step %1 %2 (:x event) event) board (:reactions step))))

(defn- event-positions
  "Event name -> {:lane :x :y} of its first sticky, from LANES of a pass."
  [lanes]
  (reduce (fn [m {:keys [key stickies]}]
            (reduce (fn [m {:keys [kind text x y]}]
                      (if (and (= :event kind) (not (m text)))
                        (assoc m text {:lane key :x x :y y})
                        m))
                    m
                    stickies))
          {}
          lanes))

(defn- place-when
  "Places the reactions of a 'when'. In the lane of its event they start
  under the event; in another lane at its left edge, no higher than the
  event. Positions come from an earlier pass (unknown at first)."
  [lane {:keys [event reactions]} positions]
  (let [{ev-lane :lane :keys [x y]} (positions event)
        same? (and (contains? positions event) (= ev-lane (:key lane)))
        lane (cond-> lane (and y (not same?)) (update :y max y))]
    (reduce #(place-step %1 %2 (if same? x 0) {:text event :pending true})
            lane
            reactions)))

(defn- place-hotspot-row [lane hotspots]
  (-> lane
      (update :stickies into
              (map-indexed (fn [i h] (sticky :hotspot (:text h) (:line h) (col-x i) (:y lane)))
                           hotspots))
      (update :y + sticky-h flow-gap)))

(defn- place-item [positions lane item]
  (case (:type item)
    :hotspot (place-hotspot-row lane [item])
    :flow (-> (place-step lane item 0 nil) (update :y + flow-gap))
    :when (-> (place-when lane item positions) (update :y + flow-gap))))

(defn- place-all
  "One layout pass: {:lanes [lane ...]} in lane-local x, a lane being
  {:key :name :line :y :stickies :arrows :pending-links}. Items before the
  first section go to an unnamed lane (key nil). Consecutive top-level
  hotspots share a row."
  [ast positions]
  (let [top (+ margin (if (some #(= :section (:type %)) ast) lane-label-h 0))
        new-lane (fn [key name line]
                   {:key key :name name :line line :y top
                    :stickies [] :arrows [] :pending-links []})
        groups (partition-by #(= :hotspot (:type %)) ast)
        ensure-lane (fn [acc key name line]
                      (-> acc
                          (update-in [:lanes key] #(or % (new-lane key name line)))
                          (update :order #(if (some (partial = key) %) % (conj % key)))))
        {:keys [lanes order]}
        (reduce
         (fn [{:keys [current] :as acc} group]
           (if (= :hotspot (:type (first group)))
             (-> (ensure-lane acc current nil nil)
                 (update-in [:lanes current] place-hotspot-row group))
             (reduce
              (fn [{:keys [current] :as acc} item]
                (if (= :section (:type item))
                  (let [key [:section (:name item)]]
                    (-> (ensure-lane acc key (:name item) (:line item))
                        (assoc :current key)))
                  (-> (ensure-lane acc current nil nil)
                      (update-in [:lanes current] #(place-item positions % item)))))
              acc
              group)))
         {:current nil :lanes {} :order []}
         groups)]
    (mapv lanes order)))

(defn- lane-width [{:keys [stickies]}]
  (apply max sticky-w (map #(+ (:x %) (:w %)) stickies)))

(defn- shift [dx {:keys [stickies arrows pending-links] :as lane}]
  (let [move-sticky #(update % :x + dx)
        move-points (fn [pts] (mapv (fn [[x y]] [(+ x dx) y]) pts))]
    (assoc lane
           :stickies (mapv move-sticky stickies)
           :arrows (mapv move-points arrows)
           :pending-links (mapv #(-> % (update :policy move-sticky) (update :group-x + dx))
                                pending-links))))

(defn- link
  "Elbow arrow from the first event sticky named EVENT into POLICY. Cancel
  links run beside 'when' links."
  [stickies {:keys [event policy group-x kind]}]
  (branch (first (filter #(and (= :event (:kind %)) (= event (:text %))) stickies))
          policy
          group-x
          (if (= :cancel kind) -6 6)))

(defn layout
  "AST into {:width :height :stickies [{:kind :text :line :x :y :w :h}]
  :arrows [[[x y] ...] ...] :links [[[x y] ...] ...] :cancels [...]
  :lanes [{:name :line :x :y :w :h}] :gaps [{:x :y :w :h}]}. Lanes are
  LANE-GAP apart; gaps are the space between them. Links are the arrows of 'when'
  reactions, cancels those from the 'unless' event of an 'after'; lanes are the named sections, as full-height bands. Lays out
  until event positions settle: a 'when' may refer to an event placed
  further down, or to one placed by another 'when'."
  [ast]
  (let [lanes (loop [positions {} passes 0]
                (let [lanes (place-all ast positions)
                      positions' (event-positions lanes)]
                  (if (or (= positions positions') (= passes 10))
                    lanes
                    (recur positions' (inc passes)))))
        band-ws (map #(+ (lane-width %) (* 2 lane-pad)) lanes)
        band-xs (reductions (fn [x w] (+ x w lane-gap)) 0 band-ws)
        placed (map (fn [lane x] (shift (+ x lane-pad) lane)) lanes band-xs)
        stickies (vec (mapcat :stickies placed))
        arrows (vec (mapcat :arrows placed))
        {links :link cancels :cancel} (group-by :kind (mapcat :pending-links placed))
        links (mapv #(link stickies %) links)
        cancels (mapv #(link stickies %) cancels)
        width (if (seq band-ws) (- (last band-xs) lane-gap) 0)
        height (+ margin (apply max 0 (concat (map #(+ (:y %) (:h %)) stickies)
                                              (map second (apply concat (concat arrows links cancels))))))]
    {:width width
     :height height
     :stickies stickies
     :arrows arrows
     :links links
     :cancels cancels
     :lanes (vec (for [[lane x w] (map vector lanes band-xs band-ws)
                       :when (:name lane)]
                   {:name (:name lane) :line (:line lane) :x x :y 0 :w w :h height}))
     :gaps (vec (for [[x w] (map vector band-xs (butlast band-ws))]
                  {:x (+ x w) :y 0 :w lane-gap :h height}))}))
