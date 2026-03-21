(ns com.blockether.styrmann.test-helpers
  "Test utilities. Provides temp Datalevin connections for isolated tests."
  (:require
   [com.blockether.styrmann.db.schema :as schema]
   [datalevin.core :as d])
  (:import
   [java.nio.file FileVisitResult Files SimpleFileVisitor]
   [java.util UUID]))

(defn delete-tree! [dir]
  (let [root (.toPath (java.io.File. dir))]
    (when (.exists (.toFile root))
      (Files/walkFileTree
       root
       (proxy [SimpleFileVisitor] []
         (visitFile [file _attrs]
           (Files/deleteIfExists file)
           FileVisitResult/CONTINUE)
         (postVisitDirectory [directory _exc]
           (Files/deleteIfExists directory)
           FileVisitResult/CONTINUE))))))

(defn temp-conn
  "Create a fresh temp Datalevin connection plus its backing dir.

   Returns:
   Vector `[conn dir]`."
  []
  (let [dir (str "/tmp/styrmann-test-" (UUID/randomUUID))]
    [(d/get-conn dir schema/schema) dir]))

(defn temp-dir
  "Create a fresh temporary directory path.

   Returns:
   Directory path string."
  []
  (let [dir (str "/tmp/styrmann-test-dir-" (UUID/randomUUID))]
    (.mkdirs (java.io.File. dir))
    dir))

(defmacro with-temp-conn
  "Execute body with a fresh Datalevin conn bound to `sym`.
   DB is created in a temp dir and cleaned up after."
  {:clj-kondo/lint-as 'clojure.core/let}
  [[sym init] & body]
  `(let [[~sym dir#] ~init]
     (try
       ~@body
       (finally
         (d/close ~sym)
         (delete-tree! dir#)))))

(defmacro with-temp-dir
  "Execute body with a temporary directory bound to `sym`.
   Directory is removed after execution."
  {:clj-kondo/lint-as 'clojure.core/let}
  [[sym init] & body]
  `(let [~sym ~init]
     (try
       ~@body
       (finally
         (delete-tree! ~sym)))))
