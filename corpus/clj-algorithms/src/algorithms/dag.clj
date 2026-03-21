(ns algorithms.dag)

(defn topo-sort
  "Kahn topological sort. Throws on cycle."
  [graph]
  (let [nodes (set (concat (keys graph) (mapcat identity (vals graph))))
        indegree (reduce (fn [m n] (assoc m n 0)) {} nodes)
        indegree (reduce (fn [m [_ tos]]
                           (reduce (fn [acc to] (update acc to inc)) m tos))
                         indegree
                         graph)]
    (loop [queue (vec (filter #(zero? (get indegree % 0)) nodes))
           indegree indegree
           out []]
      (if (empty? queue)
        (if (= (count out) (count nodes))
          out
          (throw (ex-info "Graph contains a cycle" {:graph graph :output out})))
        (let [n (first queue)
              queue (subvec queue 1)
              [indegree queue] (reduce (fn [[m q] to]
                                         (let [next-degree (dec (get m to 0))
                                               m (assoc m to next-degree)
                                               q (if (zero? next-degree) (conj q to) q)]
                                           [m q]))
                                       [indegree queue]
                                       (get graph n []))]
          (recur queue indegree (conj out n)))))))
