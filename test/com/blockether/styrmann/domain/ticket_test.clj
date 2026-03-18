(ns com.blockether.styrmann.domain.ticket-test
  (:require
   [com.blockether.styrmann.domain.organization :as organization]
   [com.blockether.styrmann.domain.ticket :as sut]
   [com.blockether.styrmann.test-helpers :refer [temp-conn with-temp-conn]]
   [lazytest.core :refer [defdescribe expect it]]))

(defn- make-upload [filename content]
  (let [file (java.io.File/createTempFile "styrmann-upload-" ".txt")]
    (spit file content)
    {:filename filename
     :content-type "text/plain"
     :size (.length file)
     :tempfile file}))

(defdescribe create!-test
  (it "creates backlog tickets with nested acceptance criteria and attachments"
      (with-temp-conn [conn (temp-conn)]
        (let [organization (organization/create! conn {:name "Blockether"})
              upload (make-upload "spec.txt" "acceptance details")]
          (try
            (let [ticket (sut/create!
                          conn
                          {:organization-id (:organization/id organization)
                           :type :ticket.type/feature
                           :title "Create organization management"
                           :description "Users can create and manage organizations"
                           :acceptance-criteria-text "- User can create an organization\n  - Name is required\n- Organization gets a backlog"
                           :story-points 5
                           :effort 4
                           :impact 9
                           :assignee "alex"
                           :attachments [upload]})]
              (expect (= :ticket.type/feature (:ticket/type ticket)))
              (expect (= [{:text "User can create an organization"
                           :children [{:text "Name is required"
                                       :children []}]}
                          {:text "Organization gets a backlog"
                           :children []}]
                         (:ticket/acceptance-criteria ticket)))
              (expect (= [{:attachment/name "spec.txt"
                           :attachment/content-type "text/plain"
                           :attachment/size 18}]
                         (map #(select-keys % [:attachment/name
                                               :attachment/content-type
                                               :attachment/size])
                              (:ticket/attachments ticket))))
              (expect (= [(:ticket/id ticket)]
                         (map :ticket/id
                              (sut/backlog conn (:organization/id organization))))))
            (finally
              (.delete (:tempfile upload))))))))

(defdescribe create!-invalid-type-test
  (it "rejects task as a business ticket type"
      (with-temp-conn [conn (temp-conn)]
        (let [organization (organization/create! conn {:name "Blockether"})
              message (try
                        (sut/create!
                         conn
                         {:organization-id (:organization/id organization)
                          :type :ticket.type/task
                          :title "This should fail"
                          :description ""
                          :acceptance-criteria-text "- nope"
                          :story-points 1
                          :effort 1
                          :impact 1
                          :assignee "alex"})
                        nil
                        (catch clojure.lang.ExceptionInfo ex
                          (ex-message ex)))]
          (expect (= "Ticket type :ticket.type/task is not allowed"
                     message))))))
