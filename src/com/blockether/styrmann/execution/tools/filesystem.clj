(ns com.blockether.styrmann.execution.tools.filesystem
  "Filesystem tools for reading, writing, searching, and listing files within
   a workspace working directory."
  (:require
   [clojure.java.io :as io]
   [clojure.java.shell :as sh]
   [clojure.string :as str])
  (:import
   [java.nio.file Files Path Paths]
   [java.util.stream Collectors]))

(defn- working-dir
  "Resolve the working directory from ctx, falling back to the current directory."
  [ctx]
  (or (get-in ctx [:environment :working-directory])
      (:working-directory ctx)
      (.getAbsolutePath (io/file "."))))

(defn- canonicalize ^String [^String root ^String path]
  (.getCanonicalPath (io/file root path)))

(defn- within-root?
  "Return true if `path` (after canonicalization relative to `root`) stays
   inside `root`."
  [^String root ^String path]
  (let [canonical-root (-> (io/file root) .getCanonicalPath)
        canonical-path (canonicalize root path)]
    (str/starts-with? canonical-path canonical-root)))

(defn- assert-within-root! [root path]
  (when-not (within-root? root path)
    (throw (ex-info "Path escapes workspace root"
                    {:root root :path path}))))

;;; ---------------------------------------------------------------------------
;;; Public tools
;;; ---------------------------------------------------------------------------

(defn read-file
  "Read file contents, optionally slicing by line range.

   Context: {:working-directory dir}
   Params:  {:path \"relative/path\"
             :start-line N (1-based, default 1)
             :end-line N (1-based inclusive, default end of file)
             :offset N (deprecated alias for start-line)
             :limit N (deprecated, number of lines from offset)}
   Returns: {:ok? true :path \"...\" :lines N :content \"line-numbered text\"}
            {:ok? false :error \"message\"}"
  [ctx {:keys [path start-line end-line offset limit]}]
  (let [root (working-dir ctx)]
    (assert-within-root! root path)
    (let [file (io/file root path)]
      (if-not (.exists file)
        {:ok? false :error (str "File not found: " path)}
        (let [lines      (str/split-lines (slurp file))
              total      (count lines)
              ;; Support both new (start-line/end-line) and old (offset/limit)
              start-idx  (dec (long (or start-line offset 1)))
              end-idx    (if end-line
                           (long end-line)
                           (if limit (+ start-idx (long limit)) total))
              start-idx  (max 0 start-idx)
              end-idx    (min total end-idx)
              sliced     (->> lines
                              (drop start-idx)
                              (take (- end-idx start-idx))
                              (map-indexed (fn [i line] (str (+ start-idx i 1) "\t" line)))
                              (str/join "\n"))]
          {:ok?     true
           :path    path
           :lines   total
           :content sliced})))))

(defn write-file
  "Write content to a file, creating parent directories as needed.

   Context: {:working-directory dir}
   Params:  {:path \"relative/path\" :content \"text\"}
   Returns: {:ok? true :written true :path \"...\"}"
  [ctx {:keys [path content]}]
  (let [root (working-dir ctx)]
    (assert-within-root! root path)
    (let [file (io/file root path)]
      (.mkdirs (.getParentFile file))
      (spit file content)
      {:ok?     true
       :written true
       :path    path})))

(defn edit-file
  "Replace the first occurrence of `old-string` with `new-string` in a file.

   Context: {:working-directory dir}
   Params:  {:path \"...\" :old-string \"...\" :new-string \"...\"}
   Returns: {:ok? true :edited true}
            {:ok? false :error \"message\"}"
  [ctx {:keys [path old-string new-string]}]
  (let [root (working-dir ctx)]
    (assert-within-root! root path)
    (let [file (io/file root path)]
      (if-not (.exists file)
        {:ok? false :error (str "File not found: " path)}
        (let [text     (slurp file)
              replaced (str/replace-first text old-string new-string)]
          (if (= text replaced)
            {:ok? false :error "old-string not found in file"}
            (do
              (spit file replaced)
              {:ok? true :edited true})))))))

(defn grep
  "Search file contents using ripgrep.

   Context: {:working-directory dir}
   Params:  {:pattern \"regex\" :path \".\" :glob \"*.clj\"}
   Returns: {:ok? true :matches [\"file:line:text\" ...] :count n}
            {:ok? false :error \"message\"}"
  [ctx {:keys [pattern path glob]}]
  (let [root   (working-dir ctx)
        target (or path ".")
        _      (assert-within-root! root target)
        args   (cond-> ["rg" "--no-heading" "--line-number" pattern
                        (canonicalize root target)]
                 glob (into ["--glob" glob]))
        {:keys [exit out err]} (apply sh/sh args)
        lines  (if (str/blank? out) [] (str/split-lines out))]
    (if (contains? #{0 1} exit)
      {:ok?     true
       :count   (count lines)
       :matches lines}
      {:ok?   false
       :error (str/trim err)})))

(defn glob-files
  "Find files matching a glob pattern under a root path.

   Context: {:working-directory dir}
   Params:  {:pattern \"**/*.clj\" :path \".\"}
   Returns: {:ok? true :files [\"relative/path\" ...] :count n}"
  [ctx {:keys [pattern path]}]
  (let [root      (working-dir ctx)
        base      (canonicalize root (or path "."))
        _         (assert-within-root! root (or path "."))
        base-path (Paths/get base (make-array String 0))
        matcher   (.getPathMatcher
                   (java.nio.file.FileSystems/getDefault)
                   (str "glob:" base "/" pattern))
        files     (-> (Files/walk base-path
                                  (make-array java.nio.file.FileVisitOption 0))
                      (.filter (reify java.util.function.Predicate
                                 (test [_ p]
                                   (and (.matches matcher p)
                                        (not (Files/isDirectory p (make-array java.nio.file.LinkOption 0)))))))
                      (.collect (Collectors/toList)))]
    {:ok?   true
     :count (count files)
     :files (mapv (fn [^Path p]
                    (.toString (.relativize base-path p)))
                  files)}))
