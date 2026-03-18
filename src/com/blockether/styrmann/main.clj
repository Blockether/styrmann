(ns com.blockether.styrmann.main
  "Production entry point for the uberjar."
  (:require
   [com.blockether.styrmann.db.core :as db]
   [nrepl.server :as nrepl]
   [ring.adapter.jetty :as jetty])
  (:gen-class))

(defn- default-handler [_req]
  {:status  200
   :headers {"Content-Type" "text/html; charset=utf-8"}
   :body    "<!doctype html><html><head><meta charset=\"UTF-8\"/><meta name=\"viewport\" content=\"width=device-width,initial-scale=1.0\"/><script src=\"https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4\"></script><script src=\"https://unpkg.com/lucide@latest\"></script></head><body class=\"flex items-center justify-center min-h-screen bg-gray-100\"><h1 class=\"text-3xl font-bold text-gray-800\"><i data-lucide=\"anchor\" class=\"inline mr-2\"></i>styrmann</h1><script>lucide.createIcons();</script></body></html>"})

(def handler #'default-handler)

(defn -main [& _args]
  (let [nrepl-port (parse-long (or (System/getenv "NREPL_PORT") "7888"))
        http-port  (parse-long (or (System/getenv "HTTP_PORT")  "3000"))
        db-path    (or (System/getenv "DB_PATH") "data/styrmann")]
    (db/start! db-path)
    (nrepl/start-server :port nrepl-port)
    (spit ".nrepl-port" (str nrepl-port))
    (println (str "[styrmann] nREPL listening on port " nrepl-port))
    (println (str "[styrmann] HTTP  listening on port " http-port))
    (jetty/run-jetty handler {:port http-port :join? true})))
