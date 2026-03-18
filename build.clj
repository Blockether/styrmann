(ns build
  (:require [clojure.tools.build.api :as b]))

(def lib 'com.blockether/styrmann)
(def version (format "0.1.%s" (or (b/git-count-revs nil) "0")))
(def class-dir "target/classes")
(def uber-file "target/styrmann.jar")
(def basis (delay (b/create-basis {:project "deps.edn"})))

(defn clean [_]
  (b/delete {:path "target"}))

(defn uberjar [_]
  (clean nil)
  (b/copy-dir {:src-dirs ["src" "resources"] :target-dir class-dir})
  (b/compile-clj {:basis     @basis
                  :src-dirs  ["src"]
                  :class-dir class-dir})
  (b/uber {:class-dir class-dir
           :uber-file uber-file
           :basis     @basis
            :main      'com.blockether.styrmann.main})
  (println (str "Built " uber-file " (" version ")")))
