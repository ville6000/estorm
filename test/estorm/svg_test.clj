(ns estorm.svg-test
  (:require [clojure.string :as str]
            [clojure.test :refer [deftest is]]
            [estorm.layout :as layout]
            [estorm.parser :as parser]
            [estorm.svg :as svg]))

(deftest wrap
  (is (= ["Fetch customer" "details"] (svg/wrap "Fetch customer details" 17)))
  (is (= ["CustomerDetails" "Fetched"] (svg/wrap "CustomerDetailsFetched" 17))
      "long words break at camel case humps")
  (is (= ["aaaaa" "aaaaa" "aa"] (svg/wrap "aaaaaaaaaaaa" 5)) "then hard")
  (is (= [] (svg/wrap "" 10))))

(deftest document
  (let [doc (-> "A: Do <it> -> Done & dusted" parser/parse layout/layout svg/svg)]
    (is (str/starts-with? doc "<svg"))
    (is (str/includes? doc "xmlns=\"http://www.w3.org/2000/svg\""))
    (is (str/includes? doc "Do &lt;it&gt;") "text is escaped")
    (is (str/includes? doc "data-line=\"1\""))))

(deftest lanes-and-links
  (let [doc (-> "== Sales ==\nA: Do -> Done\n== Billing ==\nwhen Done\n  then B -> BDone"
                parser/parse layout/layout svg/svg)]
    (is (str/includes? doc ">Billing</text>"))
    (is (str/includes? doc "class=\"link\""))))
