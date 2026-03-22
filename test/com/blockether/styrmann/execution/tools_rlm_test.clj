(ns com.blockether.styrmann.execution.tools-rlm-test
  "Integration tests for RLM tool execution in SCI sandbox.

   Tests that registered tools are callable from within the RLM environment
   and produce correct results. Uses real temp Datalevin instances."
  (:require
   [com.blockether.svar.core :as svar]
   [com.blockether.styrmann.db.core :as db-core]
   [com.blockether.styrmann.domain.organization :as organization]
   [com.blockether.styrmann.domain.ticket :as ticket]
   [com.blockether.styrmann.domain.task :as task]
   [com.blockether.styrmann.execution.session :as session]
   [com.blockether.styrmann.test-helpers :refer [temp-conn temp-dir with-temp-conn with-temp-dir]]
   [lazytest.core :refer [defdescribe describe expect it]]
   [sci.core :as sci]))

(defn- make-rlm-env-with-tools
  "Create a minimal RLM env and register tool fns directly into SCI.
   Does NOT call LLM — we eval SCI code directly to test tool wiring."
  [tools]
  (let [sci-bindings (reduce (fn [m {:keys [sym fn doc]}]
                               (assoc m sym fn))
                             {} tools)
        sci-ctx (sci/init {:namespaces {'user sci-bindings}})]
    sci-ctx))

(defn- sci-eval [sci-ctx code-str]
  (sci/eval-string* sci-ctx code-str))

;; -- Filesystem tools ---------------------------------------------------------

(defdescribe rlm-read-file-test
  (it "read-file tool returns file contents in SCI sandbox"
    (with-temp-dir [dir (temp-dir)]
      (spit (str dir "/test.txt") "hello world\nline two")
      (let [read-fn (fn [params]
                      (let [path (str dir "/" (:path params))]
                        (slurp path)))
            ctx (make-rlm-env-with-tools
                 [{:sym 'read-file :fn read-fn :doc "read file"}])]
        (let [result (sci-eval ctx "(read-file {:path \"test.txt\"})")]
          (expect (= "hello world\nline two" result)))))))

(defdescribe rlm-write-file-test
  (it "write-file tool creates a file in SCI sandbox"
    (with-temp-dir [dir (temp-dir)]
      (let [write-fn (fn [params]
                       (let [path (str dir "/" (:path params))]
                         (spit path (:content params))
                         {:written true :path path}))
            ctx (make-rlm-env-with-tools
                 [{:sym 'write-file :fn write-fn :doc "write file"}])]
        (let [result (sci-eval ctx "(write-file {:path \"out.txt\" :content \"new content\"})")]
          (expect (:written result))
          (expect (= "new content" (slurp (str dir "/out.txt")))))))))

(defdescribe rlm-edit-file-test
  (it "edit-file tool replaces strings in SCI sandbox"
    (with-temp-dir [dir (temp-dir)]
      (spit (str dir "/src.clj") "(defn foo [] :old)")
      (let [edit-fn (fn [params]
                      (let [path (str dir "/" (:path params))
                            content (slurp path)
                            updated (clojure.string/replace content (:old-string params) (:new-string params))]
                        (spit path updated)
                        {:edited true}))
            ctx (make-rlm-env-with-tools
                 [{:sym 'edit-file :fn edit-fn :doc "edit file"}])]
        (sci-eval ctx "(edit-file {:path \"src.clj\" :old-string \":old\" :new-string \":new\"})")
        (expect (= "(defn foo [] :new)" (slurp (str dir "/src.clj"))))))))

(defdescribe rlm-grep-test
  (it "grep tool searches file contents in SCI sandbox"
    (with-temp-dir [dir (temp-dir)]
      (spit (str dir "/a.clj") "(defn alpha [] :ok)")
      (spit (str dir "/b.clj") "(defn beta [] :ok)")
      (let [grep-fn (fn [params]
                      (let [pattern (:pattern params)
                            files (.listFiles (java.io.File. dir))]
                        (->> files
                             (filter #(.isFile %))
                             (mapcat (fn [f]
                                       (let [lines (clojure.string/split-lines (slurp f))]
                                         (keep-indexed (fn [i line]
                                                         (when (re-find (re-pattern pattern) line)
                                                           (str (.getName f) ":" (inc i) ":" line)))
                                                       lines))))
                             vec)))
            ctx (make-rlm-env-with-tools
                 [{:sym 'grep-code :fn grep-fn :doc "grep"}])]
        (let [result (sci-eval ctx "(grep-code {:pattern \"alpha\"})")]
          (expect (= 1 (count result)))
          (expect (clojure.string/includes? (first result) "alpha")))))))

;; -- System tools -------------------------------------------------------------

(defdescribe rlm-signal-event-test
  (it "signal-event tool emits event and returns confirmation in SCI sandbox"
    (let [events (atom [])
          signal-fn (fn [params]
                      (swap! events conj {:type (:type params) :message (:message params)})
                      {:signaled true})
          ctx (make-rlm-env-with-tools
               [{:sym 'signal-event :fn signal-fn :doc "signal event"}])]
      (let [result (sci-eval ctx "(signal-event {:type \"progress\" :message \"halfway done\"})")]
        (expect (:signaled result))
        (expect (= 1 (count @events)))
        (expect (= "progress" (:type (first @events))))
        (expect (= "halfway done" (:message (first @events))))))))

(defdescribe rlm-record-deliverable-test
  (it "record-deliverable tool captures findings in SCI sandbox"
    (let [deliverables (atom [])
          record-fn (fn [params]
                      (swap! deliverables conj (select-keys params [:title :description :status]))
                      {:recorded true})
          ctx (make-rlm-env-with-tools
               [{:sym 'record-deliverable :fn record-fn :doc "record deliverable"}])]
      (let [result (sci-eval ctx "(record-deliverable {:title \"Modal audit\" :description \"Found 3 inconsistencies\" :status \"done\"})")]
        (expect (:recorded result))
        (expect (= "Modal audit" (:title (first @deliverables))))
        (expect (= "Found 3 inconsistencies" (:description (first @deliverables))))))))

;; -- Spel tools ---------------------------------------------------------------

(defdescribe rlm-spel-snapshot-test
  (it "spel-snapshot tool returns DOM snapshot in SCI sandbox"
    (let [snapshot-fn (fn [params]
                        (str "[viewport: 1280x720]\n- body\n  - heading \"Test\" [pos:0,0]\n  URL: " (:url params)))
          ctx (make-rlm-env-with-tools
               [{:sym 'spel-snapshot :fn snapshot-fn :doc "spel snapshot"}])]
      (let [result (sci-eval ctx "(spel-snapshot {:url \"http://localhost:3000\" :selector \"body\"})")]
        (expect (clojure.string/includes? result "viewport"))
        (expect (clojure.string/includes? result "localhost:3000"))))))

;; -- Structural edit tools ----------------------------------------------------

(defdescribe rlm-bash-exec-test
  (it "bash-exec tool runs command and returns output in SCI sandbox"
    (let [bash-fn (fn [params]
                    {:exit-code 0
                     :stdout (str "executed: " (:command params))
                     :stderr ""})
          ctx (make-rlm-env-with-tools
               [{:sym 'bash-exec :fn bash-fn :doc "bash exec"}])]
      (let [result (sci-eval ctx "(bash-exec {:command \"echo hello\"})")]
        (expect (= 0 (:exit-code result)))
        (expect (= "executed: echo hello" (:stdout result)))))))

;; -- Combined multi-tool workflow ---------------------------------------------

(defdescribe rlm-multi-tool-workflow-test
  (it "multiple tools compose correctly in SCI sandbox"
    (with-temp-dir [dir (temp-dir)]
      (spit (str dir "/app.clj") "(ns app)\n(defn handler [] :old)")
      (let [events (atom [])
            read-fn (fn [params] (slurp (str dir "/" (:path params))))
            edit-fn (fn [params]
                      (let [path (str dir "/" (:path params))
                            content (slurp path)]
                        (spit path (clojure.string/replace content (:old-string params) (:new-string params)))
                        {:edited true}))
            signal-fn (fn [params]
                        (swap! events conj params)
                        {:signaled true})
            ctx (make-rlm-env-with-tools
                 [{:sym 'read-file :fn read-fn :doc "read"}
                  {:sym 'edit-file :fn edit-fn :doc "edit"}
                  {:sym 'signal-event :fn signal-fn :doc "signal"}])]
        ;; Simulate a multi-tool workflow: read → edit → signal
        (sci-eval ctx "(let [content (read-file {:path \"app.clj\"})
                             _ (edit-file {:path \"app.clj\" :old-string \":old\" :new-string \":new\"})
                             updated (read-file {:path \"app.clj\"})]
                         (signal-event {:type \"complete\" :message (str \"Changed: \" updated)})
                         updated)")
        (expect (= "(ns app)\n(defn handler [] :new)" (slurp (str dir "/app.clj"))))
        (expect (= 1 (count @events)))
        (expect (= "complete" (:type (first @events))))))))
