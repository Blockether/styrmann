(ns com.blockether.styrmann.domain.planning-test
  (:require
   [com.blockether.styrmann.domain.organization :as organization]
   [com.blockether.styrmann.domain.planning :as sut]
   [com.blockether.styrmann.domain.ticket :as ticket]
   [com.blockether.styrmann.test-helpers :refer [temp-conn with-temp-conn]]
   [lazytest.core :refer [defdescribe expect it]]))

(defn- make-ticket [conn organization-id description]
  (ticket/create!
   conn
   {:organization-id organization-id
    :type :ticket.type/feature
    :title description
    :description ""
    :acceptance-criteria-text "- first"
    :story-points 3
    :effort 3
    :impact 7
    :assignee "alex"}))

(defdescribe assign-ticket-to-sprint!-test
  (it "assigns a ticket directly to a sprint and removes it from backlog"
      (with-temp-conn [conn (temp-conn)]
        (let [organization (organization/create! conn {:name "Blockether"})
              sprint (sut/create-sprint!
                      conn
                      {:organization-id (:organization/id organization)
                       :name "Sprint 1"})
              created-ticket (make-ticket conn (:organization/id organization) "Plan sprint assignment")
              assigned-ticket (sut/assign-ticket-to-sprint!
                               conn
                               {:ticket-id (:ticket/id created-ticket)
                                :sprint-id (:sprint/id sprint)})]
          (expect (= (:sprint/id sprint)
                     (-> assigned-ticket :ticket/sprint :sprint/id)))
          (expect (= nil (:ticket/milestone assigned-ticket)))
          (expect (= []
                     (map :ticket/id
                          (ticket/backlog conn (:organization/id organization)))))))))

(defdescribe assign-ticket-to-milestone!-test
  (it "assigns a ticket to a milestone and inherits the sprint"
      (with-temp-conn [conn (temp-conn)]
        (let [organization (organization/create! conn {:name "Blockether"})
              sprint (sut/create-sprint!
                      conn
                      {:organization-id (:organization/id organization)
                       :name "Sprint 1"})
              milestone (sut/create-milestone!
                         conn
                         {:sprint-id (:sprint/id sprint)
                          :name "Milestone A"})
              created-ticket (make-ticket conn (:organization/id organization) "Plan milestone assignment")
              assigned-ticket (sut/assign-ticket-to-milestone!
                               conn
                               {:ticket-id (:ticket/id created-ticket)
                                :milestone-id (:milestone/id milestone)})]
          (expect (= (:milestone/id milestone)
                     (-> assigned-ticket :ticket/milestone :milestone/id)))
          (expect (= (:sprint/id sprint)
                     (-> assigned-ticket :ticket/sprint :sprint/id)))))))
