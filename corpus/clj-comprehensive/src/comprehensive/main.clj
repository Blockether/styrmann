(ns comprehensive.main
  (:require
   [comprehensive.config :as config]
   [comprehensive.db :as db]
   [comprehensive.domain.ticket :as ticket]))

(defn seed! [store]
  (db/save-ticket! store {:id #uuid "11111111-1111-1111-1111-111111111111"
                          :title "  Build execution layer  "
                          :status :in-progress})
  (db/save-ticket! store {:id #uuid "22222222-2222-2222-2222-222222222222"
                          :title "Ship corpus loader"
                          :status :open}))

(defn -main [& _args]
  (let [cfg (config/load-config)
        store (db/make-store)]
    (seed! store)
    (println "Loaded config:" cfg)
    (println "Ticket count:" (count (db/list-tickets store)))
    (println "Normalized title:" (ticket/normalize-title "  Multi   space   title  "))))
