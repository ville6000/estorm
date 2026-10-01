(ns estorm.main
  (:require [babashka.fs :as fs]
            [clojure.java.io :as io]
            [clojure.string :as str]
            [estorm.layout :as layout]
            [estorm.parser :as parser]
            [estorm.svg :as svg]
            [org.httpkit.server :as http]))

(defn- die [msg]
  (binding [*out* *err*] (println msg))
  (System/exit 1))

(defn- compile-file
  "{:svg string} for FILE, or {:error \"file:line: message\"}."
  [file]
  (try
    {:svg (-> (slurp file) parser/parse layout/layout svg/svg)}
    (catch clojure.lang.ExceptionInfo e
      (if-let [line (:line (ex-data e))]
        {:error (str file ":" line ": " (ex-message e))}
        (throw e)))))

(defn- check-input [in usage]
  (cond
    (nil? in) (die (str "usage: " usage))
    (not (fs/regular-file? in)) (die (str in ": no such file"))))

(defn render
  "Parse IN and write SVG to OUT (default: IN with .svg extension)."
  [& [in out]]
  (check-input in "bb render <in.estorm> [out.svg]")
  (let [out (or out (str (fs/strip-ext in) ".svg"))
        {:keys [svg error]} (compile-file in)]
    (when error (die error))
    (spit out svg)
    (println "wrote" out)))

(defn- handler [file]
  (let [page (str/replace (slurp (io/resource "estorm/preview.html")) "{{file}}" file)]
    (fn [{:keys [uri]}]
      (case uri
        "/" {:status 200
             :headers {"Content-Type" "text/html; charset=utf-8"}
             :body page}
        "/diagram.svg" (let [{:keys [svg error]} (compile-file file)]
                         (if error
                           {:status 422
                            :headers {"Content-Type" "text/plain; charset=utf-8"}
                            :body error}
                           {:status 200
                            :headers {"Content-Type" "image/svg+xml; charset=utf-8"}
                            :body svg}))
        {:status 404 :body "not found"}))))

(defn serve
  "Serve a live preview of IN on PORT (default 8080). The page re-renders
  IN every second, so edits show up without reloading."
  [& [in port]]
  (check-input in "bb serve <in.estorm> [port]")
  (let [port (or (some-> port parse-long) 8080)]
    (http/run-server (handler in) {:port port})
    (println (str "Previewing " in " at http://localhost:" port))
    @(promise)))
