(ns com.blockether.styrmann.execution.session-test
  (:require
   [com.blockether.styrmann.db.provider :as db.provider]
   [com.blockether.styrmann.domain.organization :as organization]
   [com.blockether.styrmann.domain.task :as task]
   [com.blockether.styrmann.domain.ticket :as ticket]
   [com.blockether.styrmann.execution.session :as sut]
   [com.blockether.styrmann.test-helpers :refer [temp-conn with-temp-conn]]
   [lazytest.core :refer [defdescribe expect it]]))

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
