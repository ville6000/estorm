(ns estorm.parser-test
  (:require [babashka.fs :as fs]
            [clojure.string :as str]
            [clojure.test :refer [are deftest is testing]]
            [estorm.parser :as parser]))

(defn- lines [& ls]
  (str/join "\n" ls))

(defn- error-of
  "[line message] of the parse error, or nil if TEXT parses."
  [text]
  (try
    (parser/parse text)
    nil
    (catch clojure.lang.ExceptionInfo e
      [(:line (ex-data e)) (ex-message e)])))

(deftest grammar-example
  (is (= [{:type :flow :line 3
           :informed-by [{:type :read-model :name "Ticket form with topic list" :line 2}]
           :actor "Customer"
           :command "Submit ticket"
           :via [{:type :aggregate :name "Ticket"}]
           :event "TicketSubmitted"
           :reactions
           [{:type :reaction :line 4
             :informed-by []
             :command "Fetch customer details"
             :via [{:type :external :name "CRM"}]
             :event "CustomerDetailsFetched"
             :hotspots []
             :reactions []}
            {:type :reaction :line 6
             :informed-by [{:type :read-model :name "Department topic mapping" :line 5}]
             :command "Assign by topic"
             :via [{:type :aggregate :name "Ticket"}]
             :event "TicketAssigned"
             :hotspots [{:type :hotspot :text "Who owns the topic → department mapping?" :line 7}]
             :reactions []}]
           :hotspots []}]
         (parser/parse (lines "# Ticket handling"
                              "{Ticket form with topic list}"
                              "Customer: Submit ticket -> (Ticket) -> TicketSubmitted"
                              "  then Fetch customer details -> [CRM] -> CustomerDetailsFetched"
                              "  {Department topic mapping}"
                              "  then Assign by topic -> (Ticket) -> TicketAssigned"
                              "  ! Who owns the topic → department mapping?")))))

(deftest flows
  (testing "minimal flow"
    (is (= [{:type :flow :line 1 :informed-by [] :actor "Customer"
             :command "Submit ticket" :via [] :event "TicketSubmitted" :hotspots [] :reactions []}]
           (parser/parse "Customer: Submit ticket -> TicketSubmitted"))))
  (testing "whitespace around arrows and names is trimmed"
    (is (= {:actor "A" :command "Do it" :via [{:type :external :name "X"}] :event "Done"}
           (-> (parser/parse "A  :Do it->[ X ]->  Done  ") first
               (select-keys [:actor :command :via :event]))))))

(deftest nesting
  (let [ast (parser/parse (lines "A: Do -> Done"
                                 "  then B -> BDone"
                                 "    then C -> CDone"
                                 "  then D -> DDone"
                                 "E: Go -> Gone"))]
    (is (= ["Done" "Gone"] (map :event ast)))
    (is (= ["BDone" "DDone"] (map :event (:reactions (first ast)))))
    (is (= ["CDone"] (map :event (:reactions (first (:reactions (first ast)))))))))

(deftest skipped-lines
  (is (= [] (parser/parse (lines "" "# comment" "   " "  # indented comment")))))

(deftest hotspots
  (let [[board flow] (parser/parse (lines "! board-wide"
                                          "A: Do -> Done"
                                          "! caused by Do"
                                          "  then B -> BDone"
                                          "! caused by B, despite indent"
                                          "C: Go -> Gone"))]
    (testing "before the first flow: board level"
      (is (= {:type :hotspot :text "board-wide" :line 1} board)))
    (testing "caused by the nearest step above"
      (is (= ["caused by Do"] (map :text (:hotspots flow))))
      (is (= ["caused by B, despite indent"]
             (map :text (:hotspots (first (:reactions flow)))))))))

(deftest sections-and-whens
  (let [ast (parser/parse (lines "== Sales =="
                                 "Customer: Place order -> (Order) -> OrderPlaced"
                                 "== Billing =="
                                 "! Who pays shipping?"
                                 "{Price list}"
                                 "when OrderPlaced"
                                 "  then Create invoice -> (Invoice) -> InvoiceCreated"
                                 "  ! Partial invoices?"))]
    (is (= [:section :flow :section :hotspot :when] (map :type ast)))
    (is (= ["Sales" "Billing"] (keep #(when (= :section (:type %)) (:name %)) ast)))
    (testing "hotspot right after a section header is top-level"
      (is (= "Who pays shipping?" (:text (nth ast 3)))))
    (testing "when holds its reactions; read models above it inform them"
      (let [{:keys [event line reactions]} (last ast)
            [r] reactions]
        (is (= ["OrderPlaced" 6] [event line]))
        (is (= "Create invoice" (:command r)))
        (is (= ["Price list"] (map :name (:informed-by r))))
        (is (= ["Partial invoices?"] (map :text (:hotspots r)))))))
  (testing "when may refer to an event further down, or from another when"
    (is (= [:when :flow :when]
           (map :type (parser/parse (lines "when Done"
                                           "  then B -> BDone"
                                           "A: Do -> Done"
                                           "when BDone"
                                           "  then C -> CDone")))))))

(deftest time-triggers
  (testing "after: delayed reactions, optionally cancelled by an event"
    (let [[flow] (parser/parse (lines "A: Do -> Done"
                                      "  after 30 days unless Gone"
                                      "    {Info}"
                                      "    then B -> BDone"
                                      "      ! Why?"
                                      "  after 1 hour"
                                      "    then C -> CDone"
                                      "X: Go -> Gone"))
          [after after2] (:reactions flow)]
      (is (= {:type :after :line 2 :duration "30 days" :unless "Gone" :hotspots []}
             (dissoc after :reactions)))
      (is (= ["B"] (map :command (:reactions after))))
      (is (= ["Info"] (map :name (:informed-by (first (:reactions after))))))
      (is (= ["Why?"] (map :text (:hotspots (first (:reactions after))))))
      (is (= "1 hour" (:duration after2)))
      (is (not (contains? after2 :unless)))))
  (testing "after under when"
    (is (= :after (-> (parser/parse (lines "A: Do -> Done"
                                           "when Done"
                                           "  after 2 days"
                                           "    then B -> BDone"))
                      second :reactions first :type))))
  (testing "every: a flow driven by a schedule; the time may contain colons"
    (is (= {:type :flow :schedule "night at 02:00" :command "Archive" :event "Archived"}
           (-> (parser/parse "every night at 02:00: Archive -> Archived")
               first
               (select-keys [:type :schedule :actor :command :event]))))))

(deftest errors
  (are [expected text] (= expected (error-of text))
   [1 "'then' has no parent flow"] "then Do -> Done"
   [2 "'then' must be one level deeper than its parent"] (lines "A: Do -> Done" "    then B -> C")
   [1 "flow must not be indented"] "  A: Do -> Done"
   [1 "tab in indentation"] "\tA: Do -> Done"
   [1 "indentation must be a multiple of 2 spaces"] " A: Do -> Done"
   [1 "chain must end with an event"] "A: Do"
   [1 "chain must end with an event, got [CRM]"] "A: Do -> [CRM]"
   [1 "expected (Aggregate) or [External], got Middle"] "A: Do -> Middle -> Done"
   [1 "expected a command, got (Agg)"] "A: (Agg) -> Done"
   [1 "empty item in chain"] "A: Do -> -> Done"
   [1 "invalid item: {X}"] "A: Do -> {X} -> Done"
   [1 "invalid actor: [Sys]"] "[Sys]: Do -> Done"
   [1 "empty hotspot"] "!"
   [1 "unrecognised line"] "just some prose"
   [1 "read model {X} informs nothing"] "{X}"
   [2 "read model {X} informs nothing"] (lines "A: Do -> Done" "  {X}" "B: Go -> Gone")
   [2 "read model {X} informs nothing"] (lines "A: Do -> Done" "{X}" "== S ==")
   [1 "empty section name"] "== =="
   [1 "section must not be indented"] "  == S =="
   [2 "'when' must not be indented"] (lines "A: Do -> Done" "  when Done")
   [1 "'when' expects an event name, got (Done)"] "when (Done)"
   [2 "'when' has no reactions"] (lines "A: Do -> Done" "when Done")
   [1 "'when' refers to unknown event Nope"] "when Nope\n  then B -> BDone"
   [1 "'after' has no parent flow"] (lines "after 1 day" "  then B -> BDone")
   [2 "'after' has no reactions"] (lines "A: Do -> Done" "  after 1 day")
   [2 "'unless' refers to unknown event Nope"] (lines "A: Do -> Done" "  after 1 day unless Nope" "    then B -> BDone")
   [2 "'unless' expects an event name, got (Nope)"] (lines "A: Do -> Done" "  after 1 day unless (Nope)")
   [3 "hotspot must follow a flow or reaction, not 'after'"]
   (lines "A: Do -> Done" "  after 1 day" "  ! Why?" "    then B -> BDone")
   [1 "chain must end with an event"] "every day: Archive"
   [3 "hotspot must follow a flow or reaction, not 'when'"]
   (lines "A: Do -> Done" "when Done" "! Why?" "  then B -> BDone")))

(deftest scenarios-parse
  (doseq [f (fs/glob "resources" "**.estorm")]
    (testing (str f)
      (is (seq (parser/parse (slurp (str f))))))))
