(ns com.blockether.styrmann.main
  "Production entry point for the uberjar."
  (:require
   [com.blockether.styrmann.app :as app]
   [com.blockether.styrmann.db.core :as db]
   [com.blockether.styrmann.execution.session :as session]
   [com.blockether.styrmann.runner.tool-registry :as tool-registry]
   [nrepl.server :as nrepl]
   [ring.adapter.jetty :as jetty]
   [taoensso.telemere :as t])
  (:import
   [java.lang Runtime Thread])
  (:gen-class))

(defonce ^:private !nrepl (atom nil))
(defonce ^:private !jetty (atom nil))
(defonce ^:private !shutdown-hook (atom nil))

(defn- setup-logging!
  "Configure Telemere with file output for production.
   Logs to LOG_PATH env (default: log/styrmann.log)."
  []
  (let [log-path (or (System/getenv "LOG_PATH") "log/styrmann.log")]
    (.mkdirs (.getParentFile (java.io.File. log-path)))
    (t/add-handler! :file/log
                    (t/handler:file {:path log-path
                                     :max-file-size (* 10 1024 1024)  ;; 10 MB
                                     :max-num-files 5}))
    (t/set-min-level! :info)
    (t/log! :info ["Logging initialized" {:path log-path}])))

(declare stop!)

(defn- install-shutdown-hook!
  []
  (when-not @!shutdown-hook
    (let [hook (Thread. (reify Runnable
                          (run [_]
                            (stop!)))
                        "styrmann-shutdown")]
      (.addShutdownHook (Runtime/getRuntime) hook)
      (reset! !shutdown-hook hook))))

(defn start!
  "Start Datalevin, nREPL, and Jetty. Idempotent.

   Params:
   `opts` - Map with optional `:nrepl-port`, `:http-port`, and `:db-path`.

   Returns:
   Map with running service handles."
  [{:keys [nrepl-port http-port db-path]
    :or {nrepl-port 7888
         http-port 3000
         db-path "data/styrmann"}}]
  (setup-logging!)
  (db/start! db-path)
  (tool-registry/register-default-tools!)
  (session/sync-tool-definitions! (db/conn) (tool-registry/list-tools))
  (session/ensure-explorer-agent! (db/conn))
  (when-not @!nrepl
    (let [server (nrepl/start-server :port nrepl-port)]
      (reset! !nrepl server)
      (when (pos? nrepl-port)
        (spit ".nrepl-port" (str nrepl-port)))))
  (when-not @!jetty
    (reset! !jetty (jetty/run-jetty #'app/app {:port http-port :join? false})))
  (install-shutdown-hook!)
  (t/log! :info ["Styrmann started" {:nrepl-port nrepl-port
                                     :http-port http-port
                                     :db-path db-path}])
  {:nrepl @!nrepl
   :jetty @!jetty})

(defn stop!
  "Stop Jetty, nREPL, and Datalevin. Safe to call multiple times.

   Returns:
   nil."
  []
  (when-let [server @!jetty]
    (.stop server)
    (reset! !jetty nil)
    (t/log! :info "HTTP stopped"))
  (when-let [server @!nrepl]
    (nrepl/stop-server server)
    (reset! !nrepl nil)
    (t/log! :info "nREPL stopped"))
  (db/stop!)
  (when-let [hook @!shutdown-hook]
    (when (not= (Thread/currentThread) hook)
      (try
        (.removeShutdownHook (Runtime/getRuntime) hook)
        (catch IllegalStateException _)))
    (reset! !shutdown-hook nil))
  nil)

(defn -main [& _args]
  (let [{:keys [jetty]}
        (start! {:nrepl-port (parse-long (or (System/getenv "NREPL_PORT") "7888"))
                 :http-port (parse-long (or (System/getenv "HTTP_PORT") "3000"))
                 :db-path (or (System/getenv "DB_PATH") "data/styrmann")})]
    (.join jetty)))
