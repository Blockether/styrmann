(ns com.blockether.styrmann.db.core
  "Datalevin connection management."
  (:require
   [com.blockether.styrmann.db.schema :as schema]
   [datalevin.core :as d]
   [taoensso.telemere :as t]))

(defonce ^:private !conn (atom nil))

(defn conn
  "Return the current Datalevin connection. Throws if not started."
  []
  (or @!conn
      (throw (ex-info "Database not started" {}))))

(defn start!
  "Open Datalevin at `dir` with the project schema. Idempotent."
  [dir]
  (when-not @!conn
    (let [c (d/get-conn dir schema/schema)]
      (reset! !conn c)
      (t/log! :info ["Datalevin opened" {:path dir}])))
  @!conn)

(defn stop!
  "Close the Datalevin connection."
  []
  (when-let [c @!conn]
    (d/close c)
    (reset! !conn nil)
    (t/log! :info "Datalevin closed")))

(defn db
  "Return the current database value."
  []
  (d/db (conn)))
