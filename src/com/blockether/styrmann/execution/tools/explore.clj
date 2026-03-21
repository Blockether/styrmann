(ns com.blockether.styrmann.execution.tools.explore
  "Exploration tools for indexing and mapping Clojure codebases."
  (:require
   [clojure.java.shell :as sh]
   [clojure.string :as str]))

(defn- run-cmd! [& args]
  (let [result (apply sh/sh args)]
    {:exit (:exit result)
     :out (str/trim (:out result))
     :err (str/trim (:err result))}))

(defn clojure-lsp-diagnostics
  "Run clojure-lsp diagnostics for a path.

   Input: {:path path}
   Output: {:ok? boolean :exit int :summary string :out string :err string}"
  [_ctx {:keys [path]}]
  (let [target (or path ".")
        {:keys [exit out err]} (run-cmd! "clojure-lsp" "diagnostics" "--project-root" target)]
    {:ok? (zero? exit)
     :exit exit
     :summary (if (zero? exit)
                "clojure-lsp diagnostics completed"
                "clojure-lsp diagnostics failed")
     :out out
     :err err}))

(defn namespace-map
  "Extract namespace declarations from Clojure files under path.

   Input: {:path path}
   Output: {:ok? boolean :namespaces [..] :count n}"
  [_ctx {:keys [path]}]
  (let [target (or path ".")
        {:keys [exit out err]} (run-cmd! "rg" "--no-heading" "--line-number" "^\\(ns\\s+" target "--glob" "*.clj")
        lines (if (str/blank? out) [] (str/split-lines out))
        namespaces (mapv (fn [line]
                           (let [[file ln rest] (str/split line #":" 3)
                                 ns-name (second (re-find #"\(ns\s+([^\s\)]+)" (or rest "")))]
                             {:file file :line (parse-long ln) :namespace ns-name}))
                         lines)]
    {:ok? (or (zero? exit) (= exit 1))
     :count (count namespaces)
     :namespaces namespaces
     :err err}))
