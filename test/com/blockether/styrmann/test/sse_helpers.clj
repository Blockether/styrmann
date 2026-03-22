(ns com.blockether.styrmann.test.sse-helpers
  "Test utilities for Server-Sent Events (SSE) via the Datastar SDK."
  (:require
   [clojure.string :as str]
   [ring.core.protocols :as rp]
   [starfederation.datastar.clojure.api :as d*])
  (:import
   [java.io ByteArrayOutputStream]))

(defn mock-sse-request
  "Build a minimal Ring request map suitable for SSE endpoints."
  ([] (mock-sse-request {}))
  ([opts]
   (let [{:keys [uri method headers query-params]
          :or   {uri "/fragments/home" method :get headers {}}} opts]
     {:request-method method
      :uri uri
      :scheme :http
      :server-name "localhost"
      :server-port 8080
      :headers (merge {"accept" "text/event-stream"
                      "datastar-request" "true"} headers)
      :query-params (or query-params {})
      :body nil})))

(defn capture-sse-output
  "Execute an SSE Ring response and capture everything written to the stream."
  [response]
  (let [baos (ByteArrayOutputStream.)]
    (rp/write-body-to-stream (:body response) response baos)
    (.toByteArray baos)))

(defn capture-sse-string
  "Same as capture-sse-output but returns a UTF-8 string."
  [response]
  (String. (capture-sse-output response) "UTF-8"))

(defn parse-sse-events
  "Parse raw SSE text into a sequence of event maps."
  [sse-text]
  (let [blocks (->> (str/split sse-text #"\n\n") (remove str/blank?))]
    (vec
     (for [block blocks]
       (let [lines (str/split block #"\n")
             parsed (reduce
                     (fn [acc line]
                       (cond
                         (str/starts-with? line "event:") (assoc acc :event (str/trim (subs line 6)))
                         (str/starts-with? line "data:") (update acc :data conj (str/trim (subs line 5)))
                         (str/starts-with? line "id:") (assoc acc :id (str/trim (subs line 3)))
                         (str/starts-with? line "retry:") (assoc acc :retry (str/trim (subs line 6)))
                         :else acc))
                     {:event nil :data [] :id nil :retry nil} lines)]
         (assoc parsed :raw block))))))

(defn event-data-strings
  "Extract just the joined data strings from each event."
  [sse-text]
  (mapv #(str/join "\n" (:data %)) (parse-sse-events sse-text)))

(defn mock-sse-gen
  "Create a mock SSE generator that records all sent events."
  []
  (let [events (atom [])
        closed (atom false)
        lock   (java.util.concurrent.locks.ReentrantLock.)]
    {:sse-gen (reify
                starfederation.datastar.clojure.protocols/SSEGenerator
                (send-event! [_ event-type data-lines opts]
                  (swap! events conj [event-type data-lines opts])
                  true)
                (get-lock [_] lock)
                (close-sse! [_] (reset! closed true) true)
                (sse-gen? [_] true)
                java.io.Closeable
                (close [_] (reset! closed true)))
     :events events
     :closed? closed}))

(defn has-event-type?
  "Check if any parsed event has the given event type."
  [events event-type]
  (some #(= event-type (:event %)) events))

(defn has-data-containing?
  "Check if any event data contains the substring."
  [events substring]
  (some #(str/includes? (str/join "\n" (:data %)) substring) events))
