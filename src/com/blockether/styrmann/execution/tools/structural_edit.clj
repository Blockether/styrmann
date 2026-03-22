(ns com.blockether.styrmann.execution.tools.structural-edit
  "Structural code editing tools: clojure-lsp rename/clean-ns and sandboxed
   shell execution."
  (:require
   [clojure.java.io :as io]
   [clojure.java.shell :as sh]
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
