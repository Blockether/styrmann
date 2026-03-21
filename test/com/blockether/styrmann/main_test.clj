 (ns com.blockether.styrmann.main-test
   (:require
    [com.blockether.styrmann.db.core :as db]
    [com.blockether.styrmann.domain.organization :as organization]
    [com.blockether.styrmann.main :as sut]
    [com.blockether.styrmann.test-helpers :refer [delete-tree!]]
    [darkleaf.di.core :as di]
    [lazytest.core :refer [defdescribe expect it]])
   (:import
    [java.util UUID]))

(defn- temp-db-path []
  (str "/tmp/styrmann-main-test-" (UUID/randomUUID)))

(defdescribe start-stop!-test
  (it "reopens the same Datalevin database cleanly across restarts"
      (let [db-path (temp-db-path)]
        (try
          (let [sys1 (di/start `sut/app
                       (di/update-key `sut/cfg:db-path (constantly db-path))
                       (di/update-key `sut/cfg:http-port (constantly 0))
                       (di/update-key `sut/cfg:nrepl-port (constantly 0)))
                created-org (organization/create! (db/conn) {:name (str "TestOrg-" (UUID/randomUUID))})]
            (di/stop sys1)
            (let [sys2 (di/start `sut/app
                         (di/update-key `sut/cfg:db-path (constantly db-path))
                         (di/update-key `sut/cfg:http-port (constantly 0))
                         (di/update-key `sut/cfg:nrepl-port (constantly 0)))]
              (try
                (expect (some #{(:organization/id created-org)}
                           (map :organization/id
                                (organization/list-organizations (db/conn)))))
                (finally
                  (di/stop sys2)))))
          (finally
            (delete-tree! db-path))))))
