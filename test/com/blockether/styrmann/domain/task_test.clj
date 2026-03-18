(ns com.blockether.styrmann.domain.task-test
  (:require
   [com.blockether.styrmann.domain.organization :as organization]
   [com.blockether.styrmann.domain.task :as sut]
   [com.blockether.styrmann.domain.ticket :as ticket]
   [com.blockether.styrmann.test-helpers :refer [temp-conn with-temp-conn]]
   [lazytest.core :refer [defdescribe expect it]]))

(defn- make-ticket [conn organization-id]
  (ticket/create!
   conn
   {:organization-id organization-id
    :type :ticket.type/feature
    :title "Build AI task orchestration"
    :description ""
    :acceptance-criteria-text "- inbox exists"
    :story-points 3
    :effort 3
    :impact 8
    :assignee "alex"}))

(defdescribe create!-test
  (it "creates inbox tasks inside the ticket workspace boundary"
      (with-temp-conn [conn (temp-conn)]
        (let [organization (organization/create! conn {:name "Blockether"})
              workspace (organization/create-workspace!
                         conn
                         {:organization-id (:organization/id organization)
                          :name "styrmann"
                          :repository "/root/repos/blockether/styrmann"})
              created-ticket (make-ticket conn (:organization/id organization))
              task (sut/create!
                    conn
                    {:ticket-id (:ticket/id created-ticket)
                     :workspace-id (:workspace/id workspace)
                     :description "Implement the first slice"})]
          (expect (= :task.status/inbox (:task/status task)))
          (expect (= (:ticket/id created-ticket)
                     (-> task :task/ticket :ticket/id)))
          (expect (= (:workspace/id workspace)
                     (-> task :task/workspace :workspace/id)))))))

(defdescribe update-status!-test
  (it "creates organization notifications when a task reaches review and done"
      (with-temp-conn [conn (temp-conn)]
        (let [organization (organization/create! conn {:name "Blockether"})
              workspace (organization/create-workspace!
                         conn
                         {:organization-id (:organization/id organization)
                          :name "styrmann"
                          :repository "/root/repos/blockether/styrmann"})
              created-ticket (make-ticket conn (:organization/id organization))
              task (sut/create!
                    conn
                    {:ticket-id (:ticket/id created-ticket)
                     :workspace-id (:workspace/id workspace)
                     :description "Implement the first slice"})]
          (sut/update-status! conn (:task/id task) :task.status/implementing)
          (sut/update-status! conn (:task/id task) :task.status/testing)
          (sut/update-status! conn (:task/id task) :task.status/reviewing)
          (sut/update-status! conn (:task/id task) :task.status/done)
          (expect (= [:task.status/reviewing :task.status/done]
                     (map :notification/status
                          (sut/list-notifications conn (:organization/id organization)))))))))

(defdescribe update-status!-invalid-transition-test
  (it "rejects invalid task status jumps"
      (with-temp-conn [conn (temp-conn)]
        (let [organization (organization/create! conn {:name "Blockether"})
              workspace (organization/create-workspace!
                         conn
                         {:organization-id (:organization/id organization)
                          :name "styrmann"
                          :repository "/root/repos/blockether/styrmann"})
              created-ticket (make-ticket conn (:organization/id organization))
              task (sut/create!
                    conn
                    {:ticket-id (:ticket/id created-ticket)
                     :workspace-id (:workspace/id workspace)
                     :description "Implement the first slice"})
              message (try
                        (sut/update-status! conn (:task/id task) :task.status/done)
                        nil
                        (catch clojure.lang.ExceptionInfo ex
                          (ex-message ex)))]
          (expect (= "Invalid task status transition from :task.status/inbox to :task.status/done"
                     message))))))
