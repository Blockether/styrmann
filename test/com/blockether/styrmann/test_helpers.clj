(ns com.blockether.styrmann.test-helpers
  "Test utilities. Provides temp Datalevin connections for isolated tests."
  (:require [datalevin.core :as d]
            [com.blockether.styrmann.db.schema :as schema])
  (:import [java.util UUID]))

(defmacro with-temp-conn
  "Execute body with a fresh Datalevin conn bound to `sym`.
   DB is created in a temp dir and cleaned up after."
  [[sym] & body]
  `(let [dir# (str "/tmp/styrmann-test-" (UUID/randomUUID))
         ~sym (d/get-conn dir# schema/schema)]
     (try
       ~@body
       (finally
         (d/close ~sym)
         (babashka.fs/delete-tree dir#)))))
