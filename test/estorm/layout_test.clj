(ns estorm.layout-test
  (:require [clojure.string :as str]
            [clojure.test :refer [deftest is testing]]
            [estorm.layout :as layout]
            [estorm.parser :as parser]))

(defn- board [& lines]
  (layout/layout (parser/parse (str/join "\n" lines))))

(deftest flow-row
  (let [{:keys [stickies arrows]} (board "{Cart}"
                                         "Customer: Place order -> (Order) -> [Stripe] -> OrderPlaced")]
    (is (= [:read-model :actor :command :aggregate :external :event] (map :kind stickies)))
    (is (apply = (map :y stickies)) "one row")
    (is (apply < (map :x stickies)) "left to right")
    (is (= 3 (count arrows)) "read model, actor and command side by side without arrows")
    (testing "read model, actor and command touch; the rest have gaps"
      (let [[rm actor command agg] stickies]
        (is (= (+ (:x rm) (:w rm)) (:x actor)))
        (is (= (+ (:x actor) (:w actor)) (:x command)))
        (is (< (+ (:x command) (:w command)) (:x agg)))))))

(deftest policy-group
  (let [{:keys [stickies]} (board "A: Do -> Done"
                                  "  {Info}"
                                  "  then B -> BDone")
        [rm policy command] (filter #(#{:read-model :policy :command} (:kind %)) (drop 3 stickies))]
    (is (= [:read-model :policy :command] (map :kind [rm policy command])))
    (is (= (+ (:x rm) (:w rm)) (:x policy)))
    (is (= (+ (:x policy) (:w policy)) (:x command)))))

(deftest reactions-start-under-their-event
  (let [{:keys [stickies]} (board "A: Do -> Done"
                                  "  then B -> BDone"
                                  "  then C -> CDone")
        event (first (filter #(= "Done" (:text %)) stickies))
        policies (filter #(= :policy (:kind %)) stickies)]
    (is (= ["whenever Done" "whenever Done"] (map :text policies)))
    (is (every? #(= (:x event) (:x %)) policies))
    (is (apply < (:y event) (map :y policies)) "each reaction on its own row below")))

(deftest hotspots
  (testing "board hotspots on a row of their own above the flows"
    (let [{[hotspot actor] :stickies} (board "! Why?" "A: Do -> Done")]
      (is (= :hotspot (:kind hotspot)))
      (is (< (:y hotspot) (:y actor)))))
  (testing "step hotspots right of the event that caused them"
    (let [{:keys [stickies]} (board "A: Do -> Done" "! Why?")
          [event hotspot] (take-last 2 stickies)]
      (is (= [:event :hotspot] (map :kind [event hotspot])))
      (is (= (:y event) (:y hotspot)))
      (is (< (:x event) (:x hotspot))))))

(deftest board-size-fits-stickies
  (let [{:keys [width height stickies]} (board "A: Do -> Done" "  then B -> BDone")]
    (is (every? #(<= (+ (:x %) (:w %)) width) stickies))
    (is (every? #(<= (+ (:y %) (:h %)) height) stickies))))

(deftest lanes
  (let [{:keys [lanes gaps stickies width height]} (board "A: Do -> Done"
                                                     "== Sales =="
                                                     "B: Go -> Gone"
                                                     "== Billing =="
                                                     "C: Run -> Ran"
                                                     "== Sales =="
                                                     "D: Walk -> Walked")
        find (fn [text] (first (filter #(= text (:text %)) stickies)))
        inside? (fn [{:keys [x w]} s] (<= x (:x s) (+ (:x s) (:w s)) (+ x w)))]
    (is (= ["Sales" "Billing"] (map :name lanes)) "reopened section reuses its lane")
    (is (< (:x (find "Done")) (:x (first lanes))) "before the first section: unnamed lane on the left")
    (is (apply < (map :x lanes)) "left to right")
    (is (= layout/lane-gap (- (:x (second lanes)) (+ (:x (first lanes)) (:w (first lanes)))))
        "space between lanes")
    (is (= [{:x (+ (:x (first lanes)) (:w (first lanes))) :y 0 :w layout/lane-gap :h height}]
           (rest gaps))
        "gaps fill the space between lanes; the first is after the unnamed lane")
    (is (every? #(and (zero? (:y %)) (= height (:h %))) lanes) "full height")
    (is (= width (+ (:x (last lanes)) (:w (last lanes)))))
    (doseq [[lane texts] (map vector lanes [["Gone" "Walked"] ["Ran"]])
            t texts]
      (is (inside? lane (find t)) (str t " inside " (:name lane))))
    (is (= (:y (find "Gone")) (:y (find "Ran"))) "each lane starts at the top")))

(deftest cross-lane-when
  (let [{:keys [stickies lanes links]} (board "== Sales =="
                                              "A: Do -> Done"
                                              "B: Go -> Gone"
                                              "== Billing =="
                                              "C: Run -> Ran"
                                              "when Gone"
                                              "  then D -> DDone")
        find (fn [kind text] (first (filter #(and (= kind (:kind %)) (= text (:text %))) stickies)))
        policy (find :policy "whenever Gone")]
    (is (= (+ (:x (second lanes)) 20) (:x policy)) "column 0 of its own lane")
    (is (= (:y (find :event "Gone")) (:y policy)) "level with the event")
    (is (= 1 (count links)))))

(deftest when-links
  (let [{:keys [stickies arrows links]} (board "when Done"
                                               "  then B -> BDone"
                                               "A: Do -> (Agg) -> Done"
                                               "when BDone"
                                               "  then C -> CDone")
        find (fn [kind text] (first (filter #(and (= kind (:kind %)) (= text (:text %))) stickies)))
        done (find :event "Done")
        b-done (find :event "BDone")
        p1 (find :policy "whenever Done")
        p2 (find :policy "whenever BDone")]
    (testing "policy starts in the column of the named event, even one placed later"
      (is (= (:x done) (:x p1)))
      (is (= (:x b-done) (:x p2)) "settles when one when reacts to another"))
    (is (= 2 (count links)))
    (is (= 4 (count arrows)) "links are not plain arrows; none inside the policy/command group")
    (testing "a link ends on top of its policy"
      (let [[x y] (last (first links))]
        (is (= (:y p1) y))
        (is (< (:x p1) x (+ (:x p1) (:w p1))))))))

(deftest empty-board
  (is (= 0 (:width (layout/layout [])))))

(deftest board-fits-links
  (testing "a link dipping below the last row stays on the board"
    (let [{:keys [height links]} (board "== A ==" "X: Do -> Done"
                                        "== B ==" "when Done" "  then B -> BDone")]
      (is (every? #(< (second %) height) (apply concat links))))))

(deftest time-triggers
  (let [{:keys [stickies cancels arrows]} (board "A: Do -> Done"
                                                 "  after 30 days unless Gone"
                                                 "    then B -> BDone"
                                                 "every night at 02:00: Go -> Gone")
        find (fn [kind] (first (filter #(= kind (:kind %)) stickies)))
        policy (find :policy)
        schedule (find :schedule)
        done (first (filter #(= "Done" (:text %)) stickies))]
    (testing "delayed policy, under its event"
      (is (= "⏰ 30 days after Done, unless Gone" (:text policy)))
      (is (= (:x done) (:x policy))))
    (is (= 1 (count cancels)) "cancel link from the unless event")
    (is (= [(:y policy)] (map (comp second last) cancels)) "into the policy")
    (testing "schedule takes the actor's place, touching its command"
      (is (= "⏰ every night at 02:00" (:text schedule)))
      (is (= (+ (:x schedule) (:w schedule))
             (:x (first (filter #(= "Go" (:text %)) stickies))))))
    (is (= 4 (count arrows)) "trigger arrow and chain arrows; the cancel is separate")))
