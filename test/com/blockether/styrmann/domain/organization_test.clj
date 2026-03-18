(ns com.blockether.styrmann.domain.organization-test
  (:require
   [com.blockether.styrmann.domain.organization :as sut]
   [com.blockether.styrmann.test-helpers :refer [temp-conn with-temp-conn]]
   [lazytest.core :refer [defdescribe expect it]]))

(defdescribe create!-test
  (it "creates an organization with workspace context"
      (with-temp-conn [conn (temp-conn)]
        (let [organization (sut/create! conn {:name "Blockether"})
              workspace (sut/create-workspace!
                         conn
                         {:organization-id (:organization/id organization)
                          :name "styrmann"
                          :repository "https://github.com/Blockether/styrmann"})
              overview (sut/overview conn (:organization/id organization))]
          (expect (= "Blockether" (:organization/name organization)))
          (expect (= (:organization/id organization)
                     (:organization/id overview)))
          (expect (= (:workspace/id workspace)
                     (-> overview :organization/workspaces first :workspace/id)))
          (expect (= ["styrmann"]
                     (map :workspace/name (:organization/workspaces overview))))
          (expect (= [] (:organization/backlog overview)))
          (expect (= [] (:organization/notifications overview)))
          (expect (= true (:organization/default? organization)))))))

(defdescribe default-organization-test
  (it "prefers explicitly marked default organization"
      (with-temp-conn [conn (temp-conn)]
        (let [blockether (sut/create! conn {:name "Blockether"})
              second-org (sut/create! conn {:name "Acme"})]
          (sut/set-default! conn (:organization/id second-org))
          (expect (= (:organization/id second-org)
                     (:organization/id (sut/default-organization conn))))
          (expect (= false (:organization/default? (first (filter #(= (:organization/id %) (:organization/id blockether))
                                                                  (sut/list-organizations conn))))))))))
