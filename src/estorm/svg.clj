(ns estorm.svg
  "Renders a layout (see estorm.layout) as an SVG string."
  (:require [clojure.string :as str]
            [hiccup2.core :as h]))

(def colors
  {:event      "#ffa94d"
   :command    "#74c0fc"
   :actor      "#fff3bf"
   :policy     "#d0bfff"
   :schedule   "#e5dbff"
   :aggregate  "#ffd43b"
   :external   "#f7a8c8"
   :read-model "#8ce99a"
   :hotspot    "#ff6b6b"})

(def font-size 13)
(def line-height 16)
(def padding 8)

(defn- split-word
  "[piece space-before?] pieces of WORD, none longer than MAX-CHARS.
  Long words split at camel case humps first, e.g. CustomerDetailsFetched."
  [word max-chars]
  (let [parts (if (<= (count word) max-chars)
                [word]
                (->> (str/split word #"(?<=[a-z])(?=[A-Z])")
                     (mapcat #(map str/join (partition-all max-chars %)))))]
    (map-indexed (fn [i p] [p (zero? i)]) parts)))

(defn wrap
  "Greedy word wrap of TEXT into lines of at most MAX-CHARS."
  [text max-chars]
  (let [pieces (mapcat #(split-word % max-chars) (str/split (str/trim text) #"\s+"))
        [lines cur] (reduce (fn [[lines cur] [piece space?]]
                              (let [joined (str cur (when space? " ") piece)]
                                (cond
                                  (= "" cur) [lines piece]
                                  (<= (count joined) max-chars) [lines joined]
                                  :else [(conj lines cur) piece])))
                            [[] ""]
                            pieces)]
    (cond-> lines (seq cur) (conj cur))))

(defn- sticky [{:keys [kind text line x y w h]}]
  (let [max-chars (int (/ (- w (* 2 padding)) (* 0.6 font-size)))
        lines (wrap text max-chars)
        cx (+ x (* 0.5 w))
        cy (+ y (* 0.5 h))
        top (+ cy (* -0.5 (dec (count lines)) line-height) (* 0.35 font-size))]
    [:g (cond-> {:class (name kind) :data-line line}
          (= :hotspot kind) (assoc :transform (str "rotate(-3 " cx " " cy ")")))
     [:rect {:x x :y y :width w :height h :fill (colors kind) :filter "url(#shadow)"}]
     [:text {:x cx :y top :text-anchor "middle" :font-size font-size :fill "#212529"}
      (map-indexed (fn [i l] [:tspan {:x cx :dy (if (zero? i) 0 line-height)} l])
                   lines)]]))

(defn- path-d [points]
  (str "M" (str/join " L" (map #(str/join " " %) points))))

(defn- arrow [points]
  [:path {:d (path-d points)
          :fill "none" :stroke "#868e96" :stroke-width 1.5
          :marker-end "url(#arrow)"}])

(defn- link
  "Arrow of a 'when' reaction, dashed: it may cross a lane boundary."
  [points]
  [:path {:class "link" :d (path-d points)
          :fill "none" :stroke "#495057" :stroke-width 1.5 :stroke-dasharray "6 4"
          :marker-end "url(#arrow)"}])

(defn- gap [{:keys [x y w h]}]
  [:rect {:class "gap" :x x :y y :width w :height h :fill "#e9ecef"}])

(defn- cancel
  "Arrow from the 'unless' event of an 'after' into the delayed policy:
  dotted red, it cancels the timer."
  [points]
  [:path {:class "cancel" :d (path-d points)
          :fill "none" :stroke "#e03131" :stroke-width 1.5 :stroke-dasharray "2 3"
          :marker-end "url(#cancel)"}])

(defn- lane [{:keys [name line x y]}]
  [:g {:class "lane" :data-line line}
   [:text {:x (+ x 20) :y (+ y 36) :font-size 15 :font-weight "bold" :fill "#495057"} name]])

(def ^:private defs
  [:defs
   [:marker {:id "arrow" :viewBox "0 0 10 10" :refX 9 :refY 5
             :markerWidth 7 :markerHeight 7 :orient "auto-start-reverse"}
    [:path {:d "M0 0 L10 5 L0 10 z" :fill "#868e96"}]]
   [:marker {:id "cancel" :viewBox "0 0 10 10" :refX 9 :refY 5
             :markerWidth 7 :markerHeight 7 :orient "auto-start-reverse"}
    [:path {:d "M0 0 L10 5 L0 10 z" :fill "#e03131"}]]
   [:filter {:id "shadow" :x "-10%" :y "-10%" :width "130%" :height "130%"}
    [:feDropShadow {:dx 2 :dy 3 :stdDeviation 2 :flood-opacity 0.2}]]])

(defn svg
  "Layout into a standalone SVG document string."
  [{:keys [width height stickies arrows links cancels lanes gaps]}]
  (str (h/html {:mode :xml}
               [:svg {:xmlns "http://www.w3.org/2000/svg"
                      :width width :height height
                      :viewBox (str "0 0 " width " " height)
                      :font-family "system-ui, -apple-system, sans-serif"}
                defs
                [:rect {:width "100%" :height "100%" :fill "#ffffff"}]
                (map gap gaps)
                (map lane lanes)
                (map arrow arrows)
                (map link links)
                (map cancel cancels)
                (map sticky stickies)])))
