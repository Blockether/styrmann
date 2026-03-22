(ns com.blockether.styrmann.execution.session-test
  (:require
   [com.blockether.styrmann.db.provider :as db.provider]
   [com.blockether.styrmann.db.session :as db.session]
   [com.blockether.styrmann.domain.organization :as organization]
   [com.blockether.styrmann.domain.task :as task]
   [com.blockether.styrmann.domain.ticket :as ticket]
   [com.blockether.styrmann.execution.session :as sut]
   [com.blockether.styrmann.runner.tool-registry :as tool-registry]
   [com.blockether.styrmann.test-helpers :refer [temp-conn with-temp-conn]]
   [lazytest.core :refer [defdescribe describe expect it]]))

(defn- make-ticket [conn organization-id]
  (ticket/create!
   conn
   {:organization-id organization-id
    :type :ticket.type/feature
    :title "Launch runner work"
    :description ""
    :acceptance-criteria-text "- launch process"
    :story-points 2
    :effort 2
    :impact 6
    :assignee "alex"}))

(defdescribe execute!-test
  (it "stores a task to run to pid mapping and captures process logs"
      (with-temp-conn [conn (temp-conn)]
        (let [organization (organization/create! conn {:name "Blockether"})
              workspace (organization/create-workspace!
                         conn
                         {:organization-id (:organization/id organization)
                          :name "styrmann"
                          :repository "/root/repos/blockether/styrmann"})
              created-ticket (make-ticket conn (:organization/id organization))
              created-task (task/create!
                            conn
                            {:ticket-id (:ticket/id created-ticket)
                             :workspace-id (:workspace/id workspace)
                             :description "Execute the task"})
              run (sut/execute!
                   conn
                   {:task-id (:task/id created-task)
                    :command ["bash" "-lc" "printf 'hello from run'; sleep 2"]})]
          (Thread/sleep 150)
          (let [running-observation (sut/observe conn (:session/id run))]
            (expect (= (:task/id created-task)
                       (-> run :session/workflow :workflow/task :task/id)))
            (expect (= (:session/pid run)
                       (:session/pid running-observation)))
            (expect (= :session.runtime/running (:session/runtime-status running-observation))))
          (Thread/sleep 2200)
          (let [finished-observation (sut/observe conn (:session/id run))]
            (expect (= :session.runtime/exited (:session/runtime-status finished-observation)))
            (expect (= "hello from run"
                       (:session/logs finished-observation))))))))

(defdescribe configure-workspace-environment!-test
  (it "stores OpenAI-compatible runtime settings for a workspace"
      (with-temp-conn [conn (temp-conn)]
        (let [organization (organization/create! conn {:name "Blockether"})
              workspace (organization/create-workspace!
                         conn
                         {:organization-id (:organization/id organization)
                          :name "styrmann"
                          :repository "/root/repos/blockether/styrmann"})
              _provider (db.provider/create-provider!
                         conn
                         {:name "Test Provider"
                          :base-url "https://api.example.com/v1"
                          :api-key "test-key"
                          :default? true})
              environment (sut/configure-workspace-environment!
                           conn
                           {:workspace-id (:workspace/id workspace)
                            :provider-id (:provider/id _provider)
                            :model "gpt-4.1"
                            :working-directory "/root/repos/blockether/styrmann"
                            :status :execution-environment.status/ready})]
          (expect (= "gpt-4.1" (:execution-environment/model environment)))
          (expect (= "Test Provider"
                     (get-in environment [:execution-environment/provider :provider/name])))))))

(defdescribe sync-tool-definitions!-test
  (it "syncs classpath tool definitions into Datalevin"
      (with-temp-conn [conn (temp-conn)]
        (let [tools [{:key "tool.alpha"
                      :name "Alpha"
                      :description "Alpha tool"
                      :fn-symbol "foo.alpha/run"
                      :input-schema {:type :map :required [:id]}}
                     {:key "tool.beta"
                      :name "Beta"
                      :description "Beta tool"
                      :fn-symbol "foo.beta/run"
                      :input-schema {:type :map :required [:workspace-id]}}]
              synced (sut/sync-tool-definitions! conn tools)]
          (expect (= 2 (count synced)))
          (expect (= ["tool.alpha" "tool.beta"]
                     (mapv :tool-definition/key synced)))
          (expect (= ["foo.alpha/run" "foo.beta/run"]
                     (mapv :tool-definition/fn-symbol synced)))))))

(defdescribe ensure-explorer-agent!-test
  (it "creates explorer agent bound to explore.* tools"
      (with-temp-conn [conn (temp-conn)]
        (sut/sync-tool-definitions!
         conn
         [{:key "explore.clojure-lsp-diagnostics"
           :name "Clojure LSP Diagnostics"
           :description "Run clojure-lsp diagnostics"
           :fn-symbol "com.blockether.styrmann.execution.tools.explore/clojure-lsp-diagnostics"
           :input-schema {:type :map :required [:path]}}
          {:key "explore.namespace-map"
           :name "Namespace Map"
           :description "Collect namespace declarations"
           :fn-symbol "com.blockether.styrmann.execution.tools.explore/namespace-map"
           :input-schema {:type :map :required [:path]}}
          {:key "tool.non-explore"
           :name "Non Explore"
           :description "Non explore tool"
           :fn-symbol "foo.non/explore"
           :input-schema {:type :map :required [:id]}}])
        (let [agent (sut/ensure-explorer-agent! conn)
              tool-keys (mapv :tool-definition/key (:agent/tools agent))]
          (expect (= "explorer-v1" (:agent/key agent)))
          (expect (= ["explore.clojure-lsp-diagnostics" "explore.namespace-map"]
                     (sort tool-keys)))))))

(defdescribe execute-exploration!-test
  (it "runs explorer tools and persists session calls and events"
      (with-temp-conn [conn (temp-conn)]
        (let [organization (organization/create! conn {:name "Blockether"})
              workspace (organization/create-workspace!
                         conn
                         {:organization-id (:organization/id organization)
                          :name "styrmann"
                          :repository "/root/repos/blockether/styrmann"})]
          (sut/sync-tool-definitions!
           conn
           [{:key "explore.clojure-lsp-diagnostics"
             :name "Clojure LSP Diagnostics"
             :description "Run clojure-lsp diagnostics"
             :fn-symbol "com.blockether.styrmann.execution.tools.explore/clojure-lsp-diagnostics"
             :input-schema {:type :map :required [:path]}}
            {:key "explore.namespace-map"
             :name "Namespace Map"
             :description "Collect namespace declarations"
             :fn-symbol "com.blockether.styrmann.execution.tools.explore/namespace-map"
             :input-schema {:type :map :required [:path]}}])
          (let [session (sut/execute-exploration! conn {:workspace-id (:workspace/id workspace)})
                calls (:session/calls session)
                events (:session/events session)]
            (expect (= :session.status/succeeded (:session/status session)))
            (expect (= 2 (count calls)))
            (expect (= 5 (count events)))
            (expect (= #{:session.calls.status/succeeded}
                       (set (map :session.calls/status calls)))))))))

(defn- seed-tools! [conn]
  (sut/sync-tool-definitions!
   conn
   [{:key "explore.read-file" :name "Read File" :description "Read file"
     :fn-symbol "com.blockether.styrmann.execution.tools.filesystem/read-file"
     :input-schema {:type :map :required [:path]}}
    {:key "explore.grep" :name "Grep" :description "Search"
     :fn-symbol "com.blockether.styrmann.execution.tools.filesystem/grep"
     :input-schema {:type :map :required [:pattern]}}
    {:key "explore.clojure-lsp-diagnostics" :name "LSP Diag" :description "Diagnostics"
     :fn-symbol "com.blockether.styrmann.execution.tools.explore/clojure-lsp-diagnostics"
     :input-schema {:type :map :required [:path]}}
    {:key "edit.write-file" :name "Write File" :description "Write"
     :fn-symbol "com.blockether.styrmann.execution.tools.filesystem/write-file"
     :input-schema {:type :map :required [:path :content]}}
    {:key "edit.bash" :name "Bash" :description "Shell"
     :fn-symbol "com.blockether.styrmann.execution.tools.structural-edit/bash-exec"
     :input-schema {:type :map :required [:command]}}
    {:key "system.signal-event" :name "Signal" :description "Emit event"
     :fn-symbol "com.blockether.styrmann.execution.tools.system/signal-event"
     :input-schema {:type :map :required [:type :message]}}
    {:key "ticket.find" :name "Find Ticket" :description "Find ticket"
     :fn-symbol "com.blockether.styrmann.runner.tools.ticket/find-ticket"
     :input-schema {:type :map :required [:ticket-id]}}]))

(defn- make-session [conn]
  (let [organization (organization/create! conn {:name "TestOrg"})
        workspace (organization/create-workspace!
                   conn {:organization-id (:organization/id organization)
                         :name "ws" :repository "/tmp"})
        t (ticket/create! conn {:organization-id (:organization/id organization)
                                 :type :ticket.type/feature :title "Test"
                                 :acceptance-criteria-text "- AC1"
                                 :story-points 1 :effort 1 :impact 1 :assignee "bot"})
        task-record (task/create! conn {:ticket-id (:ticket/id t)
                                        :workspace-id (:workspace/id workspace)
                                        :description "test task"})
        env (db.session/create-environment!
             conn {:workspace-id (:workspace/id workspace)
                   :model "test" :working-directory "/tmp"
                   :status :execution-environment.status/ready})
        seed (seed-tools! conn)
        agent (sut/ensure-explorer-agent! conn)
        workflow (db.session/create-workflow! conn {:task-id (:task/id task-record)})
        session (db.session/create-session!
                 conn {:workflow-id (:workflow/id workflow)
                       :environment-id (:execution-environment/id env)
                       :agent-id (:agent/id agent)
                       :pid 0 :command-edn "[]" :log-path "" :exit-path ""
                       :working-directory "/tmp"})]
    session))

(defdescribe with-tool-event-test
  (it "emits call-start and call-end events around tool execution"
    (with-temp-conn [conn (temp-conn)]
      (let [session (make-session conn)
            sid (:session/id session)
            result (sut/with-tool-event conn sid "test.tool"
                     #(do {:computed "value"}))]
        (expect (= {:computed "value"} result))
        (let [events (sut/list-session-events conn sid)
              types (mapv :session.event/type events)]
          (expect (= 2 (count events)))
          (expect (= [:session.event.type/call-start :session.event.type/call-end] types))))))

  (it "emits call-error event when tool throws"
    (with-temp-conn [conn (temp-conn)]
      (let [session (make-session conn)
            sid (:session/id session)
            threw? (atom false)]
        (try
          (sut/with-tool-event conn sid "broken.tool"
            #(throw (ex-info "boom" {})))
          (catch Exception _
            (reset! threw? true)))
        (expect @threw?)
        (let [events (sut/list-session-events conn sid)
              types (mapv :session.event/type events)]
          (expect (= 2 (count events)))
          (expect (= [:session.event.type/call-start :session.event.type/call-error] types)))))))

(defdescribe ensure-editor-agent!-test
  (it "creates editor agent with read+write tool profile"
    (with-temp-conn [conn (temp-conn)]
      (seed-tools! conn)
      (let [agent (sut/ensure-editor-agent! conn)
            tool-keys (set (mapv :tool-definition/key (:agent/tools agent)))]
        (expect (= "editor-v1" (:agent/key agent)))
        ;; Editor gets both explore and edit tools
        (expect (contains? tool-keys "explore.read-file"))
        (expect (contains? tool-keys "explore.grep"))
        (expect (contains? tool-keys "edit.write-file"))
        (expect (contains? tool-keys "edit.bash"))
        (expect (contains? tool-keys "system.signal-event"))))))

(defdescribe ensure-explorer-agent!-scoped-test
  (it "explorer agent gets only read-only tools, not write tools"
    (with-temp-conn [conn (temp-conn)]
      (seed-tools! conn)
      (let [agent (sut/ensure-explorer-agent! conn)
            tool-keys (set (mapv :tool-definition/key (:agent/tools agent)))]
        (expect (= "explorer-v1" (:agent/key agent)))
        ;; Explorer gets read tools
        (expect (contains? tool-keys "explore.read-file"))
        (expect (contains? tool-keys "explore.grep"))
        (expect (contains? tool-keys "system.signal-event"))
        ;; Explorer does NOT get write tools
        (expect (not (contains? tool-keys "edit.write-file")))
        (expect (not (contains? tool-keys "edit.bash")))))))

(defdescribe with-tool-event-params-test
  (it "records input params in call-start event payload"
    (with-temp-conn [conn (temp-conn)]
      (let [session (make-session conn)
            sid     (:session/id session)]
        (sut/with-tool-event conn sid "fs.read-file"
          {:path "src/app.clj" :start-line 1 :end-line 10}
          #(do {:ok? true :content "1\t(ns app)"}))
        (let [events  (sut/list-session-events conn sid)
              start   (first (filter #(= :session.event.type/call-start
                                        (:session.event/type %))
                                     events))
              payload (:session.event/payload start)]
          (expect (= "fs.read-file" (:tool-key payload)))
          (expect (some? (:input payload)))
          (expect (clojure.string/includes? (:input payload) "src/app.clj"))))))

  (it "truncates long string values in call-start input to 200 chars"
    (with-temp-conn [conn (temp-conn)]
      (let [session (make-session conn)
            sid     (:session/id session)
            long-str (apply str (repeat 300 \x))]
        (sut/with-tool-event conn sid "fs.write-file"
          {:path "out.txt" :content long-str}
          #(do {:ok? true}))
        (let [events  (sut/list-session-events conn sid)
              start   (first (filter #(= :session.event.type/call-start
                                        (:session.event/type %))
                                     events))
              payload (:session.event/payload start)
              input   (clojure.edn/read-string (:input payload))]
          (expect (<= (count (:content input)) 203))  ;; 200 + "..."
          (expect (clojure.string/ends-with? (:content input) "..."))))))

  (it "truncates call-end output summary at 500 chars"
    (with-temp-conn [conn (temp-conn)]
      (let [session  (make-session conn)
            sid      (:session/id session)
            big-str  (apply str (repeat 600 \a))]
        (sut/with-tool-event conn sid "fs.read-file"
          nil
          #(do big-str))
        (let [events   (sut/list-session-events conn sid)
              end-ev   (first (filter #(= :session.event.type/call-end
                                         (:session.event/type %))
                                      events))
              output   (get-in end-ev [:session.event/payload :output])]
          (expect (<= (count output) 503))  ;; 500 + "..."
          (expect (clojure.string/ends-with? output "...")))))

  (it "records result map truncating long string values in call-end output"
    (with-temp-conn [conn (temp-conn)]
      (let [session (make-session conn)
            sid     (:session/id session)
            long-v  (apply str (repeat 300 \z))]
        (sut/with-tool-event conn sid "tool.x"
          nil
          #(do {:ok? true :content long-v}))
        (let [events  (sut/list-session-events conn sid)
              end-ev  (first (filter #(= :session.event.type/call-end
                                        (:session.event/type %))
                                     events))
              output  (get-in end-ev [:session.event/payload :output])]
          (expect (some? output))
          (expect (clojure.string/includes? output "...")))))))
)