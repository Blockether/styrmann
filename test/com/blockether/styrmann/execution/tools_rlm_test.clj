(ns com.blockether.styrmann.execution.tools-rlm-test
  "Integration tests for RLM tool execution in SCI sandbox.

   Tests that registered tools are callable from within the RLM environment
   and produce correct results. Uses real temp Datalevin instances and real
   filesystem tools — NO MOCKS."
  (:require
   [com.blockether.styrmann.db.session :as db.session]
   [com.blockether.styrmann.domain.execution-context :as execution-context]
   [com.blockether.styrmann.domain.organization :as organization]
   [com.blockether.styrmann.domain.task :as task]
   [com.blockether.styrmann.domain.ticket :as ticket]
   [com.blockether.styrmann.execution.session :as session]
   [com.blockether.styrmann.execution.tools.filesystem :as filesystem]
   [com.blockether.styrmann.execution.tools.structural-edit :as structural-edit]
   [com.blockether.styrmann.execution.tools.system :as system-tools]
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

;; ---------------------------------------------------------------------------
;; Helpers for DB-backed tools
;; ---------------------------------------------------------------------------

(defn- make-org-workspace-ticket [conn]
  (let [org (organization/create! conn {:name "TestOrg"})
        ws  (organization/create-workspace!
             conn
             {:organization-id (:organization/id org)
              :name "test-ws"
              :repository "/tmp/test-repo"})
        tkt (ticket/create!
             conn
             {:organization-id (:organization/id org)
              :type :ticket.type/feature
              :title "Feature ticket"
              :description "Feature description"
              :acceptance-criteria-text "- AC one"
              :story-points 2
              :effort 3
              :impact 7
              :assignee "dev"})]
    {:org org :workspace ws :ticket tkt}))

(defn- make-minimal-session [conn workspace task-id]
  (let [env   (db.session/create-environment!
               conn
               {:workspace-id      (:workspace/id workspace)
                :model             "test-model"
                :working-directory "/tmp"
                :status            :execution-environment.status/ready})
        agent (db.session/create-agent!
               conn
               {:key              "stub-agent"
                :name             "Stub Agent"
                :version          "0.0.1"
                :role             "stub"
                :instructions-edn (pr-str [])
                :tool-ids         []})
        wf    (db.session/create-workflow! conn {:task-id task-id})
        sess  (db.session/create-session!
               conn
               {:workflow-id       (:workflow/id wf)
                :environment-id    (:execution-environment/id env)
                :agent-id          (:agent/id agent)
                :pid               0
                :command-edn       "[]"
                :log-path          ""
                :exit-path         ""
                :working-directory "/tmp"})]
    sess))

;; -- Filesystem tools ---------------------------------------------------------

(defdescribe rlm-read-file-test
  (it "read-file tool returns file contents in SCI sandbox"
    (with-temp-dir [dir (temp-dir)]
      (spit (str dir "/test.txt") "hello world\nline two")
      (let [ctx-map {:working-directory dir}
            read-fn (fn [params] (filesystem/read-file ctx-map params))
            sci-ctx (make-rlm-env-with-tools
                     [{:sym 'read-file :fn read-fn :doc "read file"}])]
        (let [result (sci-eval sci-ctx "(read-file {:path \"test.txt\"})")]
          (expect (= true (:ok? result)))
          (expect (= "1\thello world\n2\tline two" (:content result))))))))

(defdescribe rlm-write-file-test
  (it "write-file tool creates a file in SCI sandbox"
    (with-temp-dir [dir (temp-dir)]
      (let [ctx-map  {:working-directory dir}
            write-fn (fn [params] (filesystem/write-file ctx-map params))
            sci-ctx  (make-rlm-env-with-tools
                      [{:sym 'write-file :fn write-fn :doc "write file"}])]
        (let [result (sci-eval sci-ctx "(write-file {:path \"out.txt\" :content \"new content\"})")]
          (expect (= true (:written result)))
          (expect (= "new content" (slurp (str dir "/out.txt")))))))))

(defdescribe rlm-edit-file-test
  (it "edit-file tool replaces strings in SCI sandbox"
    (with-temp-dir [dir (temp-dir)]
      (spit (str dir "/src.clj") "(defn foo [] :old)")
      (let [ctx-map {:working-directory dir}
            edit-fn (fn [params] (filesystem/edit-file ctx-map params))
            sci-ctx (make-rlm-env-with-tools
                     [{:sym 'edit-file :fn edit-fn :doc "edit file"}])]
        (sci-eval sci-ctx "(edit-file {:path \"src.clj\" :old-string \":old\" :new-string \":new\"})")
        (expect (= "(defn foo [] :new)" (slurp (str dir "/src.clj"))))))))

(defdescribe rlm-grep-test
  (it "grep tool searches file contents in SCI sandbox"
    (with-temp-dir [dir (temp-dir)]
      (spit (str dir "/alpha.clj") "(defn alpha-fn [] :ok)\n")
      (spit (str dir "/beta.clj") "(defn beta-fn [] :ok)\n")
      (let [ctx-map {:working-directory dir}
            grep-fn (fn [params] (filesystem/grep ctx-map params))
            sci-ctx (make-rlm-env-with-tools
                     [{:sym 'grep-code :fn grep-fn :doc "grep"}])]
        (let [result (sci-eval sci-ctx "(grep-code {:pattern \"alpha-fn\"})")]
          (expect (= true (:ok? result)))
          (expect (= 1 (:count result)))
          (expect (clojure.string/ends-with? (first (:matches result)) "alpha.clj:1:(defn alpha-fn [] :ok)")))))))

;; -- System tools -------------------------------------------------------------

(defdescribe rlm-signal-event-test
  (it "signal-event tool emits event and returns confirmation in SCI sandbox"
    (with-temp-conn [conn (temp-conn)]
      (let [ctx (execution-context/make-context conn)
            {:keys [ticket workspace]} (make-org-workspace-ticket conn)
            task-rec  (task/create! conn {:ticket-id    (:ticket/id ticket)
                                          :workspace-id (:workspace/id workspace)
                                          :description  "test task"})
            sess      (make-minimal-session conn workspace (:task/id task-rec))
            sid       (:session/id sess)
            ctx-map   {:ctx ctx :session-id sid}
            signal-fn (fn [params] (system-tools/signal-event ctx-map params))
            sci-ctx   (make-rlm-env-with-tools
                       [{:sym 'signal-event :fn signal-fn :doc "signal event"}])]
        (let [result (sci-eval sci-ctx "(signal-event {:type \"progress\" :message \"halfway done\" :payload {}})")]
          (expect (= true (:ok? result)))
          (let [events (session/list-session-events ctx sid)]
            (expect (= 1 (count events)))
            (expect (= :session.event.type/progress (:session.event/type (first events))))
            (expect (= "halfway done" (:session.event/message (first events))))))))))

(defdescribe rlm-record-deliverable-test
  (it "record-deliverable tool captures findings in SCI sandbox"
    (with-temp-conn [conn (temp-conn)]
      (let [ctx (execution-context/make-context conn)
            {:keys [ticket workspace]} (make-org-workspace-ticket conn)
            task-rec   (task/create! conn {:ticket-id    (:ticket/id ticket)
                                           :workspace-id (:workspace/id workspace)
                                           :description  "test task"})
            tid        (:task/id task-rec)
            ctx-map    {:ctx ctx}
            record-fn  (fn [params] (system-tools/record-deliverable ctx-map params))
            sci-ctx    (make-rlm-env-with-tools
                        [{:sym 'record-deliverable :fn record-fn :doc "record deliverable"}])]
        (let [result (sci-eval sci-ctx (str "(record-deliverable {:task-id \"" tid
                                            "\" :title \"Modal audit\" :description \"Found 3 inconsistencies\" :status \"done\"})"))]
          (expect (= true (:ok? result)))
          (expect (= "Modal audit" (:title (first (:deliverables result)))))
          (expect (= "Found 3 inconsistencies" (:description (first (:deliverables result))))))))))

;; -- Structural edit tools ----------------------------------------------------

(defdescribe rlm-bash-exec-test
  (it "bash-exec tool runs command and returns output in SCI sandbox"
    (with-temp-dir [dir (temp-dir)]
      (let [ctx-map {:working-directory dir}
            bash-fn (fn [params] (structural-edit/bash-exec ctx-map params))
            sci-ctx (make-rlm-env-with-tools
                     [{:sym 'bash-exec :fn bash-fn :doc "bash exec"}])]
        (let [result (sci-eval sci-ctx "(bash-exec {:command \"echo hello\"})")]
          (expect (= true (:ok? result)))
          (expect (= 0 (:exit-code result)))
          (expect (= "hello" (:stdout result))))))))

;; -- Combined multi-tool workflow ---------------------------------------------

(defdescribe rlm-multi-tool-workflow-test
  (it "multiple tools compose correctly in SCI sandbox"
    (with-temp-dir [dir (temp-dir)]
      (with-temp-conn [conn (temp-conn)]
        (spit (str dir "/app.clj") "(ns app)\n(defn handler [] :old)")
        (let [ctx (execution-context/make-context conn)
              {:keys [ticket workspace]} (make-org-workspace-ticket conn)
              task-rec  (task/create! conn {:ticket-id    (:ticket/id ticket)
                                            :workspace-id (:workspace/id workspace)
                                            :description  "test task"})
              sess      (make-minimal-session conn workspace (:task/id task-rec))
              sid       (:session/id sess)
              ctx-map   {:working-directory dir}
              sys-ctx   {:ctx ctx :session-id sid}
              read-fn   (fn [params] (filesystem/read-file ctx-map params))
              edit-fn   (fn [params] (filesystem/edit-file ctx-map params))
              signal-fn (fn [params] (system-tools/signal-event sys-ctx params))
              sci-ctx   (make-rlm-env-with-tools
                         [{:sym 'read-file    :fn read-fn   :doc "read"}
                          {:sym 'edit-file    :fn edit-fn   :doc "edit"}
                          {:sym 'signal-event :fn signal-fn :doc "signal"}])]
          ;; Simulate a multi-tool workflow: read → edit → signal
          (sci-eval sci-ctx "(let [_ (edit-file {:path \"app.clj\" :old-string \":old\" :new-string \":new\"})
                                   updated (read-file {:path \"app.clj\"})]
                               (signal-event {:type \"complete\" :message (str \"Changed: \" (:content updated)) :payload {}})
                               updated)")
          (expect (= "(ns app)\n(defn handler [] :new)" (slurp (str dir "/app.clj"))))
          (let [events (session/list-session-events ctx sid)]
            (expect (= 1 (count events)))
            (expect (= :session.event.type/complete (:session.event/type (first events))))))))))
