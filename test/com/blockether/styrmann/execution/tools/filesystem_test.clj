(ns com.blockether.styrmann.execution.tools.filesystem-test
  "Unit tests for filesystem tools: read-file, write-file, edit-file, grep, glob-files.
   Tests path security, line range slicing, and content operations."
  (:require
   [com.blockether.styrmann.execution.tools.filesystem :as sut]
   [com.blockether.styrmann.test-helpers :refer [temp-dir with-temp-dir]]
   [lazytest.core :refer [defdescribe describe expect it]]))

(defn- ctx [dir]
  {:working-directory dir})

(defn- throws-exception?
  "Returns true if calling f throws any Exception."
  [f]
  (try (f) false (catch Exception _ true)))

;; ---------------------------------------------------------------------------
;; read-file
;; ---------------------------------------------------------------------------

(defdescribe read-file-test
  (describe "returns file not found error when file is absent"
    (it "returns :ok? false with error message"
      (with-temp-dir [dir (temp-dir)]
        (let [result (sut/read-file (ctx dir) {:path "nonexistent.txt"})]
          (expect (= false (:ok? result)))
          (expect (= "File not found: nonexistent.txt" (:error result)))))))

  (describe "reads full file contents with line numbers"
    (it "returns all lines numbered from 1"
      (with-temp-dir [dir (temp-dir)]
        (spit (str dir "/hello.txt") "alpha\nbeta\ngamma")
        (let [result (sut/read-file (ctx dir) {:path "hello.txt"})]
          (expect (= true (:ok? result)))
          (expect (= "hello.txt" (:path result)))
          (expect (= 3 (:lines result)))
          (expect (= "1\talpha\n2\tbeta\n3\tgamma" (:content result)))))))

  (describe "slices by start-line and end-line"
    (it "returns only the requested line range"
      (with-temp-dir [dir (temp-dir)]
        (spit (str dir "/multi.txt") "line1\nline2\nline3\nline4\nline5")
        (let [result (sut/read-file (ctx dir) {:path "multi.txt"
                                               :start-line 2
                                               :end-line 4})]
          (expect (= true (:ok? result)))
          (expect (= 5 (:lines result)))
          (expect (= "2\tline2\n3\tline3\n4\tline4" (:content result))))))

    (it "clamps end-line to file length when end-line exceeds total lines"
      (with-temp-dir [dir (temp-dir)]
        (spit (str dir "/short.txt") "a\nb\nc")
        (let [result (sut/read-file (ctx dir) {:path "short.txt"
                                               :start-line 2
                                               :end-line 999})]
          (expect (= true (:ok? result)))
          (expect (= "2\tb\n3\tc" (:content result))))))

    (it "reads single line when start-line equals end-line"
      (with-temp-dir [dir (temp-dir)]
        (spit (str dir "/exact.txt") "first\nsecond\nthird")
        (let [result (sut/read-file (ctx dir) {:path "exact.txt"
                                               :start-line 2
                                               :end-line 2})]
          (expect (= true (:ok? result)))
          (expect (= "2\tsecond" (:content result)))))))

  (describe "path security"
    (it "rejects path that escapes workspace root via .."
      (with-temp-dir [dir (temp-dir)]
        (expect (throws-exception? #(sut/read-file (ctx dir) {:path "../../etc/passwd"})))))

    (it "rejects symlink that points outside the workspace root"
      (with-temp-dir [dir (temp-dir)]
        ;; Create a file outside the workspace
        (let [outside-file (java.io.File/createTempFile "outside" ".txt")]
          (try
            (spit outside-file "secret content")
            ;; Create a symlink inside the workspace pointing to the outside file
            (let [link-path (java.nio.file.Paths/get (str dir "/escape-link.txt") (make-array String 0))
                  target    (java.nio.file.Paths/get (.getAbsolutePath outside-file) (make-array String 0))]
              (java.nio.file.Files/createSymbolicLink link-path target (make-array java.nio.file.attribute.FileAttribute 0))
              (expect (throws-exception? #(sut/read-file (ctx dir) {:path "escape-link.txt"}))))
            (finally
              (.delete outside-file))))))))

;; ---------------------------------------------------------------------------
;; write-file
;; ---------------------------------------------------------------------------

(defdescribe write-file-test
  (describe "creates file with content"
    (it "returns :ok? true and writes content to disk"
      (with-temp-dir [dir (temp-dir)]
        (let [result (sut/write-file (ctx dir) {:path "out.txt" :content "hello write"})]
          (expect (= true (:ok? result)))
          (expect (= true (:written result)))
          (expect (= "out.txt" (:path result)))
          (expect (= "hello write" (slurp (str dir "/out.txt")))))))

    (it "creates parent directories as needed"
      (with-temp-dir [dir (temp-dir)]
        (let [result (sut/write-file (ctx dir) {:path "a/b/c/nested.txt" :content "deep"})]
          (expect (= true (:ok? result)))
          (expect (= "deep" (slurp (str dir "/a/b/c/nested.txt")))))))

    (it "overwrites existing file"
      (with-temp-dir [dir (temp-dir)]
        (spit (str dir "/target.txt") "old content")
        (sut/write-file (ctx dir) {:path "target.txt" :content "new content"})
        (expect (= "new content" (slurp (str dir "/target.txt")))))))

  (describe "path security"
    (it "rejects path that escapes workspace root via .."
      (with-temp-dir [dir (temp-dir)]
        (expect (throws-exception? #(sut/write-file (ctx dir) {:path "../../tmp/evil.txt" :content "bad"})))))))

;; ---------------------------------------------------------------------------
;; edit-file
;; ---------------------------------------------------------------------------

(defdescribe edit-file-test
  (describe "replaces first occurrence of old-string"
    (it "returns :ok? true and updates the file on disk"
      (with-temp-dir [dir (temp-dir)]
        (spit (str dir "/src.clj") "(defn foo [] :old-value)")
        (let [result (sut/edit-file (ctx dir) {:path       "src.clj"
                                               :old-string ":old-value"
                                               :new-string ":new-value"})]
          (expect (= true (:ok? result)))
          (expect (= true (:edited result)))
          (expect (= "(defn foo [] :new-value)" (slurp (str dir "/src.clj")))))))

    (it "replaces only the first occurrence when old-string appears multiple times"
      (with-temp-dir [dir (temp-dir)]
        (spit (str dir "/dup.txt") "foo foo foo")
        (sut/edit-file (ctx dir) {:path "dup.txt" :old-string "foo" :new-string "bar"})
        (expect (= "bar foo foo" (slurp (str dir "/dup.txt")))))))

  (describe "returns error when old-string is not found"
    (it "returns :ok? false with descriptive error"
      (with-temp-dir [dir (temp-dir)]
        (spit (str dir "/file.txt") "actual content")
        (let [result (sut/edit-file (ctx dir) {:path       "file.txt"
                                               :old-string "nonexistent"
                                               :new-string "replacement"})]
          (expect (= false (:ok? result)))
          (expect (= "old-string not found in file" (:error result)))))))

  (describe "returns error when file does not exist"
    (it "returns :ok? false with file-not-found message"
      (with-temp-dir [dir (temp-dir)]
        (let [result (sut/edit-file (ctx dir) {:path "missing.txt" :old-string "x" :new-string "y"})]
          (expect (= false (:ok? result)))
          (expect (= "File not found: missing.txt" (:error result)))))))

  (describe "path security"
    (it "rejects path that escapes workspace root via .."
      (with-temp-dir [dir (temp-dir)]
        (expect (throws-exception? #(sut/edit-file (ctx dir) {:path "../sneaky.txt"
                                                              :old-string "x"
                                                              :new-string "y"})))))))

;; ---------------------------------------------------------------------------
;; grep
;; ---------------------------------------------------------------------------

(defdescribe grep-test
  (describe "finds pattern matches across files"
    (it "returns matched lines with file:line:content format"
      (with-temp-dir [dir (temp-dir)]
        (spit (str dir "/alpha.clj") "(defn alpha-fn [] :ok)\n(defn other [] :ok)")
        (spit (str dir "/beta.clj") "(defn beta-fn [] :ok)")
        (let [result (sut/grep (ctx dir) {:pattern "alpha-fn"})]
          (expect (= true (:ok? result)))
          (expect (= 1 (:count result)))
          (expect (clojure.string/ends-with? (first (:matches result)) "alpha.clj:1:(defn alpha-fn [] :ok)")))))

    (it "returns empty matches when pattern is not found"
      (with-temp-dir [dir (temp-dir)]
        (spit (str dir "/code.clj") "(defn nothing-interesting [])")
        (let [result (sut/grep (ctx dir) {:pattern "xyz-nonexistent-pattern-99"})]
          (expect (= true (:ok? result)))
          (expect (= 0 (:count result)))
          (expect (= [] (:matches result))))))

    (it "filters by glob pattern"
      (with-temp-dir [dir (temp-dir)]
        (spit (str dir "/match.clj") "target-word in clj file")
        (spit (str dir "/skip.txt") "target-word in txt file")
        (let [result (sut/grep (ctx dir) {:pattern "target-word" :glob "*.clj"})]
          (expect (= true (:ok? result)))
          (expect (= 1 (:count result)))
          (expect (clojure.string/ends-with? (first (:matches result)) "match.clj:1:target-word in clj file"))))))

  (describe "path security"
    (it "rejects path argument that escapes workspace root"
      (with-temp-dir [dir (temp-dir)]
        (expect (throws-exception? #(sut/grep (ctx dir) {:pattern "foo" :path "../../etc"})))))))

;; ---------------------------------------------------------------------------
;; glob-files
;; ---------------------------------------------------------------------------

(defdescribe glob-files-test
  (describe "finds files matching glob pattern"
    (it "returns relative paths for all matching files"
      (with-temp-dir [dir (temp-dir)]
        (.mkdirs (java.io.File. (str dir "/src")))
        (spit (str dir "/src/a.clj") "ns a")
        (spit (str dir "/src/b.clj") "ns b")
        (spit (str dir "/src/c.txt") "not clj")
        (let [result (sut/glob-files (ctx dir) {:pattern "**/*.clj"})]
          (expect (= true (:ok? result)))
          (expect (= 2 (:count result)))
          (expect (= #{"src/a.clj" "src/b.clj"} (set (:files result)))))))

    (it "returns zero files when no files match"
      (with-temp-dir [dir (temp-dir)]
        (spit (str dir "/readme.md") "# Readme")
        (let [result (sut/glob-files (ctx dir) {:pattern "**/*.clj"})]
          (expect (= true (:ok? result)))
          (expect (= 0 (:count result)))
          (expect (= [] (:files result))))))

    (it "searches within a sub-path when path is specified"
      (with-temp-dir [dir (temp-dir)]
        (.mkdirs (java.io.File. (str dir "/sub/pkg")))
        (spit (str dir "/root.clj") "in root")
        (spit (str dir "/sub/pkg/nested.clj") "in sub")
        (let [result (sut/glob-files (ctx dir) {:pattern "**/*.clj" :path "sub"})]
          (expect (= true (:ok? result)))
          (expect (= 1 (:count result)))
          (expect (= "pkg/nested.clj" (first (:files result))))))))

  (describe "path security"
    (it "rejects path argument that escapes workspace root"
      (with-temp-dir [dir (temp-dir)]
        (expect (throws-exception? #(sut/glob-files (ctx dir) {:pattern "**/*.clj" :path "../.."})))))))
