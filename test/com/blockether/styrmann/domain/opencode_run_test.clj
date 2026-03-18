(ns com.blockether.styrmann.domain.opencode-run-test
  (:require
   [com.blockether.styrmann.domain.opencode-run :as sut]
   [com.blockether.styrmann.domain.organization :as organization]
   [com.blockether.styrmann.domain.task :as task]
   [com.blockether.styrmann.domain.ticket :as ticket]
   [com.blockether.styrmann.test-helpers :refer [temp-conn with-temp-conn]]
   [lazytest.core :refer [defdescribe expect it]]))

(defn- make-ticket [conn organization-id]
  (ticket/create!
   conn
   {:organization-id organization-id
    :type :ticket.type/feature
    :title "Launch OpenCode work"
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
          (let [running-observation (sut/observe conn (:opencode-run/id run))]
            (expect (= (:task/id created-task)
                       (-> run :opencode-run/task :task/id)))
            (expect (= (:opencode-run/pid run)
                       (:opencode-run/pid running-observation)))
            (expect (= :run.status/running (:run/status running-observation))))
          (Thread/sleep 2200)
          (let [finished-observation (sut/observe conn (:opencode-run/id run))]
            (expect (= :run.status/exited (:run/status finished-observation)))
            (expect (= "hello from run"
                       (:run/logs finished-observation))))))))
