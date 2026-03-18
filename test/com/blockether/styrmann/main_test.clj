 (ns com.blockether.styrmann.main-test
   (:require
    [com.blockether.styrmann.db.core :as db]
    [com.blockether.styrmann.domain.organization :as organization]
    [com.blockether.styrmann.main :as sut]
    [com.blockether.styrmann.test-helpers :refer [delete-tree!]]
    [lazytest.core :refer [defdescribe expect it]])
   (:import
    [java.util UUID]))

(defn- temp-db-path []
  (str "/tmp/styrmann-main-test-" (UUID/randomUUID)))

(defdescribe start-stop!-test
  (it "reopens the same Datalevin database cleanly across restarts"
      (let [db-path (temp-db-path)]
        (try
          (sut/start! {:db-path db-path
                       :http-port 0
                       :nrepl-port 0})
          (let [created-org (organization/create! (db/conn) {:name "Blockether"})]
            (sut/stop!)
            (sut/start! {:db-path db-path
                         :http-port 0
                         :nrepl-port 0})
            (expect (= [(:organization/id created-org)]
                       (map :organization/id
                            (organization/list-organizations (db/conn))))))
          (finally
            (sut/stop!)
            (delete-tree! db-path))))))
