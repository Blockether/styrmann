(ns com.blockether.styrmann.domain.task-test
  (:require
   [clojure.edn :as edn]
   [com.blockether.styrmann.domain.organization :as organization]
   [com.blockether.styrmann.domain.task :as sut]
   [com.blockether.styrmann.domain.ticket :as ticket]
   [com.blockether.styrmann.test-helpers :refer [temp-conn with-temp-conn]]
   [lazytest.core :refer [defdescribe describe expect it]]))

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

(defdescribe create!-with-criteria-test
  (it "round-trips acceptance criteria and CoVe questions through EDN"
      (with-temp-conn [conn (temp-conn)]
        (let [organization  (organization/create! conn {:name "Blockether"})
              workspace     (organization/create-workspace!
                             conn
                             {:organization-id (:organization/id organization)
                              :name "styrmann"
                              :repository "/root/repos/blockether/styrmann"})
              created-ticket (make-ticket conn (:organization/id organization))
              criteria       [{:text "endpoint returns 200" :children []}]
              questions      ["Does the endpoint handle auth errors?"]
              task           (sut/create!
                              conn
                              {:ticket-id               (:ticket/id created-ticket)
                               :workspace-id            (:workspace/id workspace)
                               :description             "Implement the API endpoint"
                               :acceptance-criteria-edn (pr-str criteria)
                               :cove-questions-edn      (pr-str questions)})]
          (expect (= criteria  (edn/read-string (:task/acceptance-criteria-edn task))))
          (expect (= questions (edn/read-string (:task/cove-questions-edn task))))))))

(defdescribe create-graph!-test
  (describe "DAG creation"
    (it "creates a 3-task chain A -> B -> C with resolved dependency refs"
        (with-temp-conn [conn (temp-conn)]
          (let [organization   (organization/create! conn {:name "Blockether"})
                workspace      (organization/create-workspace!
                                conn
                                {:organization-id (:organization/id organization)
                                 :name "styrmann"
                                 :repository "/root/repos/blockether/styrmann"})
                created-ticket (make-ticket conn (:organization/id organization))
                workspace-id   (:workspace/id workspace)
                specs          [{:workspace-id workspace-id :description "Task A"}
                                {:workspace-id workspace-id :description "Task B" :depends-on-indices [0]}
                                {:workspace-id workspace-id :description "Task C" :depends-on-indices [1]}]
                tasks          (sut/create-graph! conn (:ticket/id created-ticket) specs)
                task-a         (nth tasks 0)
                task-b         (nth tasks 1)
                task-c         (nth tasks 2)]
            (expect (= 3 (count tasks)))
            (expect (= :task.status/inbox (:task/status task-a)))
            (expect (empty? (:task/depends-on task-a)))
            (expect (= [(:task/id task-a)]
                       (mapv :task/id (:task/depends-on task-b))))
            (expect (= [(:task/id task-b)]
                       (mapv :task/id (:task/depends-on task-c)))))))

    (it "rejects circular dependencies with structured errors"
        (with-temp-conn [conn (temp-conn)]
          (let [organization   (organization/create! conn {:name "Blockether"})
                workspace      (organization/create-workspace!
                                conn
                                {:organization-id (:organization/id organization)
                                 :name "styrmann"
                                 :repository "/root/repos/blockether/styrmann"})
                created-ticket (make-ticket conn (:organization/id organization))
                workspace-id   (:workspace/id workspace)
                specs          [{:workspace-id workspace-id :description "Task A" :depends-on-indices [1]}
                                {:workspace-id workspace-id :description "Task B" :depends-on-indices [0]}]
                ex-data-map    (try
                                 (sut/create-graph! conn (:ticket/id created-ticket) specs)
                                 nil
                                 (catch clojure.lang.ExceptionInfo ex
                                   (ex-data ex)))]
            (expect (= :invalid-graph (:type ex-data-map)))
            (expect (some #(= :cycle (:type %)) (:errors ex-data-map))))))))

(defdescribe dependency-graph-test
  (it "returns all tasks for a ticket with resolved :task/depends-on refs"
      (with-temp-conn [conn (temp-conn)]
        (let [organization   (organization/create! conn {:name "Blockether"})
              workspace      (organization/create-workspace!
                              conn
                              {:organization-id (:organization/id organization)
                               :name "styrmann"
                               :repository "/root/repos/blockether/styrmann"})
              created-ticket (make-ticket conn (:organization/id organization))
              workspace-id   (:workspace/id workspace)
              specs          [{:workspace-id workspace-id :description "Task A"}
                              {:workspace-id workspace-id :description "Task B" :depends-on-indices [0]}]
              created-tasks  (sut/create-graph! conn (:ticket/id created-ticket) specs)
              graph          (sut/dependency-graph conn (:ticket/id created-ticket))
              task-b         (first (filter #(= "Task B" (:task/description %)) graph))]
          (expect (= 2 (count graph)))
          (expect (= 1 (count (:task/depends-on task-b))))
          (expect (= "Task A" (-> task-b :task/depends-on first :task/description)))
          (expect (some? created-tasks))))))

(defdescribe validate-graph-test
  (describe "pure validation"
    (it "returns valid for a correct DAG"
        (let [ws-id (java.util.UUID/randomUUID)
              specs [{:workspace-id ws-id :description "Task A"}
                     {:workspace-id ws-id :description "Task B" :depends-on-indices [0]}]
              result (sut/validate-graph specs)]
          (expect (true? (:valid result)))))

    (it "detects blank descriptions"
        (let [ws-id (java.util.UUID/randomUUID)
              specs [{:workspace-id ws-id :description ""}]
              {:keys [valid errors]} (sut/validate-graph specs)]
          (expect (false? valid))
          (expect (= :blank-description (:type (first errors))))))

    (it "detects out-of-bounds dependency indices"
        (let [ws-id (java.util.UUID/randomUUID)
              specs [{:workspace-id ws-id :description "Task A" :depends-on-indices [5]}]
              {:keys [valid errors]} (sut/validate-graph specs)]
          (expect (false? valid))
          (expect (= :index-out-of-bounds (:type (first errors))))))

    (it "detects self-dependencies"
        (let [ws-id (java.util.UUID/randomUUID)
              specs [{:workspace-id ws-id :description "Task A" :depends-on-indices [0]}]
              {:keys [valid errors]} (sut/validate-graph specs)]
          (expect (false? valid))
          (expect (= :self-dependency (:type (first errors))))))

    (it "returns cycle path with task descriptions"
        (let [ws-id (java.util.UUID/randomUUID)
              specs [{:workspace-id ws-id :description "Task A" :depends-on-indices [1]}
                     {:workspace-id ws-id :description "Task B" :depends-on-indices [0]}]
              {:keys [valid errors]} (sut/validate-graph specs)
              cycle-error (first (filter #(= :cycle (:type %)) errors))]
          (expect (false? valid))
          (expect (some? cycle-error))
          (expect (seq (:indices cycle-error)))
          (expect (seq (:descriptions cycle-error)))))

    (it "detects invalid workspace-id"
        (let [specs [{:workspace-id "not-a-uuid" :description "Task A"}]
              {:keys [valid errors]} (sut/validate-graph specs)]
          (expect (false? valid))
          (expect (= :invalid-workspace (:type (first errors))))))))

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
