(ns com.blockether.styrmann.main
  "Production entry point for the uberjar.
   Uses darkleaf/di for dependency injection and lifecycle management."
  (:require
   [com.blockether.styrmann.app :as app]
   [com.blockether.styrmann.bootstrap :as bootstrap]
   [com.blockether.styrmann.db.core :as db]
   [com.blockether.styrmann.domain.execution-context :as execution-context]
   [com.blockether.styrmann.execution.session :as session]
   [com.blockether.styrmann.execution.tool-registry :as tool-registry]
   [darkleaf.di.core :as di]
   [nrepl.server :as nrepl]
   [ring.adapter.jetty :as jetty]
   [taoensso.telemere :as t])
  (:gen-class))

;; -- Configuration -----------------------------------------------------------

(defn cfg:db-path
  {::di/kind :component}
  [_deps]
  (or (System/getenv "DB_PATH") "data/styrmann"))

(defn cfg:http-port
  {::di/kind :component}
  [_deps]
  (parse-long (or (System/getenv "HTTP_PORT") "3000")))

(defn cfg:nrepl-port
  {::di/kind :component}
  [_deps]
  (parse-long (or (System/getenv "NREPL_PORT") "7888")))

;; -- Components --------------------------------------------------------------

(defn datalevin
  "Datalevin connection component."
  {::di/kind :component}
  [{db-path `cfg:db-path}]
  (let [log-path (or (System/getenv "LOG_PATH") "log/styrmann.log")]
    (.mkdirs (.getParentFile (java.io.File. log-path)))
    (t/add-handler! :file/log
                    (t/handler:file {:path log-path
                                     :max-file-size (* 10 1024 1024)
                                     :max-num-files 5}))
    (t/set-min-level! :info))
  (let [conn (db/start! db-path)]
    (t/log! :info ["Datalevin started" {:path db-path}])
    (reify
      clojure.lang.IDeref (deref [_] conn)
      java.lang.AutoCloseable
      (close [_]
        (db/stop!)
        (t/log! :info "Datalevin stopped")))))

(defn init-tools!
  "Register default tools, sync to DB, and bootstrap.

   Params:
   `conn` - Datalevin connection.

   Returns:
   nil."
  [conn]
  (let [ctx (execution-context/make-context conn)]
    (tool-registry/register-default-tools!)
    (session/sync-tool-definitions! ctx (tool-registry/list-tools))
    (session/ensure-explorer-agent! ctx)
    (bootstrap/ensure-from-git! conn))
  (t/log! :info "Tools registered and bootstrap complete"))

(defn tool-registry
  "Register default tools and sync to DB."
  {::di/kind :component}
  [{datalevin `datalevin}]
  (init-tools! @datalevin)
  (reify java.lang.AutoCloseable (close [_])))

(defn nrepl-server
  "nREPL server component."
  {::di/kind :component}
  [{port `cfg:nrepl-port
    _datalevin `datalevin}]
  (let [server (nrepl/start-server :port port)]
    (spit ".nrepl-port" (str port))
    (t/log! :info ["nREPL listening" {:port port}])
    (reify java.lang.AutoCloseable
      (close [_]
        (nrepl/stop-server server)
        (t/log! :info "nREPL stopped")))))

(defn http-server
  "Jetty HTTP server component."
  {::di/kind :component}
  [{port `cfg:http-port
    _tools `tool-registry
    datalevin `datalevin}]
  (let [conn @datalevin
        app-handler (app/make-app conn)
        server (jetty/run-jetty app-handler {:port port :join? false})]
    (t/log! :info ["HTTP listening" {:port port}])
    (reify
      clojure.lang.IDeref (deref [_] server)
      java.lang.AutoCloseable
      (close [_]
        (doseq [c (.getConnectors server)]
          (.close c))
        (.stop server)
        (.join server)
        (t/log! :info "HTTP stopped")))))

(defn app
  "Root component — HTTP server + DB + tools. nREPL is managed separately."
  {::di/kind :component}
  [{http `http-server}]
  (t/log! :info "Styrmann started")
  (reify
    clojure.lang.IDeref (deref [_] @http)
    java.lang.AutoCloseable
    (close [_]
      (t/log! :info "Styrmann stopping"))))

;; -- Entry point -------------------------------------------------------------

(defn -main [& _args]
  (let [nrepl-port (parse-long (or (System/getenv "NREPL_PORT") "7888"))
        nrepl (nrepl/start-server :port nrepl-port)
        _ (spit ".nrepl-port" (str nrepl-port))
        _ (t/log! :info ["nREPL listening" {:port nrepl-port}])
        system (di/start `app)]
    (.addShutdownHook (Runtime/getRuntime)
                      (Thread. (fn []
                                 (di/stop system)
                                 (nrepl/stop-server nrepl))
                               "styrmann-shutdown"))
    (.join @(di/ref `http-server))))
