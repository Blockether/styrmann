(ns algorithms.main
  (:require
   [algorithms.dag :as dag]
   [algorithms.dp :as dp]
   [algorithms.graph :as graph]
   [algorithms.interval :as interval]))

(def sample-graph
  {:a [[:b 4] [:c 2]]
   :b [[:d 5]]
   :c [[:b 1] [:d 8] [:e 10]]
   :d [[:e 2]]
   :e []})

(def sample-dag
  {:schema [:api]
   :api [:ui]
   :ui [:e2e]
   :e2e []})

(defn -main [& _args]
  (println "Shortest path a->e:" (graph/shortest-path sample-graph :a :e))
  (println "Topo order:" (dag/topo-sort sample-dag))
  (println "Merged intervals:" (interval/merge-intervals [[1 4] [2 6] [8 10] [9 12]]))
  (println "Edit distance (ticket/task):" (dp/edit-distance "ticket" "task")))
