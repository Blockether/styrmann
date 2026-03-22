(ns com.blockether.styrmann.execution.tools.structural-edit
  "Structural code editing tools: clojure-lsp rename/clean-ns, sandboxed
   shell execution, and form-level Clojure file creation/modification."
  (:require
   [clojure.java.io :as io]
   [clojure.java.shell :as sh]
   [clojure.pprint :as pprint]
   [clojure.string :as str]))

(defn- working-dir [ctx]
  (or (get-in ctx [:environment :working-directory])
      (:working-directory ctx)
      (.getAbsolutePath (io/file "."))))

(defn- within-root? [^String root ^String path]
  (let [canonical-root (.getCanonicalPath (io/file root))
        canonical-path (.getCanonicalPath (io/file root path))]
    (str/starts-with? canonical-path canonical-root)))

(defn- assert-within-root! [root path]
  (when-not (within-root? root path)
    (throw (ex-info "Path escapes workspace root"
                    {:root root :path path}))))

(defn- absolute-path [root path]
  (.getCanonicalPath (io/file root path)))

;;; ---------------------------------------------------------------------------
;;; Public tools
;;; ---------------------------------------------------------------------------

(defn clojure-lsp-rename
  "Rename a symbol at a given file position via clojure-lsp.

   Context: {:working-directory dir}
   Params:  {:path \"src/...\" :line N :column N :new-name \"new-sym\"}
   Returns: {:ok? true :exit 0 :out \"...\" :err \"...\"}
            {:ok? false :error \"message\"}"
  [ctx {:keys [path line column new-name]}]
  (let [root    (working-dir ctx)
        _       (assert-within-root! root path)
        abspath (absolute-path root path)
        {:keys [exit out err]}
        (sh/sh "clojure-lsp" "rename"
               "--from" (str abspath ":" line ":" column)
               "--to" new-name
               "--project-root" root)]
    (if (zero? exit)
      {:ok? true  :exit exit :out (str/trim out) :err (str/trim err)}
      {:ok? false :exit exit :error (str/trim err) :out (str/trim out)})))

(defn clojure-lsp-clean-ns
  "Clean and sort the namespace form of a Clojure file via clojure-lsp.

   Context: {:working-directory dir}
   Params:  {:path \"src/...\"}
   Returns: {:ok? true :exit 0 :out \"...\"}
            {:ok? false :error \"message\"}"
  [ctx {:keys [path]}]
  (let [root    (working-dir ctx)
        _       (assert-within-root! root path)
        abspath (absolute-path root path)
        {:keys [exit out err]}
        (sh/sh "clojure-lsp" "clean-ns"
               "--namespace-from-file" abspath
               "--project-root" root)]
    (if (zero? exit)
      {:ok? true  :exit exit :out (str/trim out)}
      {:ok? false :exit exit :error (str/trim err) :out (str/trim out)})))

(defn bash-exec
  "Execute a shell command sandboxed to the workspace working directory.

   The command runs via `bash -c` with the working directory set to the
   workspace root. An optional timeout (milliseconds) kills the process if
   exceeded.

   Context: {:working-directory dir}
   Params:  {:command \"string\" :timeout-ms N}
   Returns: {:ok? true :exit-code N :stdout \"...\" :stderr \"...\"}
            {:ok? false :exit-code N :stdout \"...\" :stderr \"...\" :error \"message\"}"
  [ctx {:keys [command timeout-ms]}]
  (when (str/blank? command)
    (throw (ex-info "command is required" {})))
  (let [root    (working-dir ctx)
        timeout (or timeout-ms 30000)
        pb      (doto (ProcessBuilder. ["bash" "-c" command])
                  (.directory (io/file root)))
        process (.start pb)
        done?   (.waitFor process timeout java.util.concurrent.TimeUnit/MILLISECONDS)]
    (if-not done?
      (do
        (.destroyForcibly process)
        {:ok?        false
         :exit-code  -1
         :stdout     ""
         :stderr     ""
         :error      (str "Command timed out after " timeout "ms: " command)})
      (let [exit-code (.exitValue process)
            stdout    (str/trim (slurp (.getInputStream process)))
            stderr    (str/trim (slurp (.getErrorStream process)))]
        (if (zero? exit-code)
          {:ok?       true
           :exit-code exit-code
           :stdout    stdout
           :stderr    stderr}
          {:ok?       false
           :exit-code exit-code
           :stdout    stdout
           :stderr    stderr
           :error     (str "Command exited with code " exit-code)})))))

;;; ---------------------------------------------------------------------------
;;; Structural Clojure editing — form-level file creation and modification
;;; ---------------------------------------------------------------------------

(defn- format-require
  "Format a single require entry from data to string.
   Input:  [clojure.string :as str]  or  [lazytest.core :refer [defdescribe it]]
   Output: \"[clojure.string :as str]\" or \"[lazytest.core :refer [defdescribe it]]\""
  [req]
  (let [ns-sym (first req)
        pairs (partition 2 (rest req))]
    (str "[" ns-sym
         (str/join ""
           (map (fn [[k v]]
                  (str " " k " "
                       (if (sequential? v)
                         (str "[" (str/join " " v) "]")
                         v)))
                pairs))
         "]")))

(defn- format-import
  "Format a single import entry from data to string.
   Input:  [java.util UUID Date]
   Output: \"[java.util UUID Date]\""
  [imp]
  (str "[" (str/join " " imp) "]"))

(defn- build-ns-form
  "Build a namespace declaration string from structured data."
  [{:keys [ns-name doc requires imports]}]
  (let [parts [(str "(ns " ns-name)
               (when doc (str "  " (pr-str doc)))
               (when (seq requires)
                 (str "  (:require\n"
                      (str/join "\n" (map #(str "   " (format-require %)) requires))
                      ")"))
               (when (seq imports)
                 (str "  (:import\n"
                      (str/join "\n" (map #(str "   " (format-import %)) imports))
                      ")"))]]
    (str (str/join "\n" (remove nil? parts)) ")\n")))

(defn create-ns-file
  "Create a new Clojure file with a namespace declaration from structured data.
   No string escaping needed — ns form is built from data.

   Context: {:working-directory dir}
   Params:  {:path \"relative/path.clj\"
             :ns-name com.example.foo (symbol, not string)
             :doc \"Optional docstring\"
             :requires [[clojure.string :as str] [lazytest.core :refer [defdescribe it]]]
             :imports [[java.util UUID]]}
   Returns: {:ok? true :written true :path \"...\"}
            {:ok? false :error \"message\"}"
  [ctx {:keys [path ns-name doc requires imports]}]
  (when-not ns-name
    (throw (ex-info "ns-name is required" {})))
  (when (str/blank? path)
    (throw (ex-info "path is required" {})))
  (let [root (working-dir ctx)]
    (assert-within-root! root path)
    (let [file (io/file root path)
          content (build-ns-form {:ns-name ns-name :doc doc
                                  :requires requires :imports imports})]
      (.mkdirs (.getParentFile file))
      (spit file content)
      {:ok? true :written true :path path})))

(defn append-form
  "Append a Clojure form to the end of a file. The form is a quoted Clojure
   data structure that gets pretty-printed. No string escaping needed — write
   actual Clojure data, not strings.

   Context: {:working-directory dir}
   Params:  {:path \"relative/path.clj\"
             :form '(defn my-fn [x] (+ x 1))}
   Returns: {:ok? true :appended true :path \"...\"}
            {:ok? false :error \"message\"}"
  [ctx {:keys [path form]}]
  (when-not form
    (throw (ex-info "form is required" {})))
  (when (str/blank? path)
    (throw (ex-info "path is required" {})))
  (let [root (working-dir ctx)]
    (assert-within-root! root path)
    (let [file (io/file root path)]
      (if-not (.exists file)
        {:ok? false :error (str "File not found: " path ". Use create-ns-file first.")}
        (let [formatted (with-out-str (pprint/write form :dispatch pprint/code-dispatch))
              existing (slurp file)
              separator (if (str/ends-with? (str/trimr existing) ")") "\n\n" "\n")]
          (spit file (str existing separator formatted))
          {:ok? true :appended true :path path})))))
