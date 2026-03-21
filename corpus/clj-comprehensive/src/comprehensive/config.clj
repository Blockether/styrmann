(ns comprehensive.config)

(defn env
  [k default]
  (or (System/getenv k) default))

(defn load-config []
  {:port (parse-long (env "PORT" "3000"))
   :db-path (env "DB_PATH" "/tmp/comprehensive-db")
   :log-level (keyword (env "LOG_LEVEL" "info"))})
