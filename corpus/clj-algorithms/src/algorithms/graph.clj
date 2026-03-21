(ns algorithms.graph)

(defn neighbors
  [graph node]
  (get graph node []))

(defn- relax-edge [dist prev from [to weight]]
  (let [candidate (+ (get dist from Long/MAX_VALUE) weight)]
    (if (< candidate (get dist to Long/MAX_VALUE))
      [(assoc dist to candidate) (assoc prev to from)]
      [dist prev])))

(defn dijkstra
  "Returns {:dist {node distance} :prev {node predecessor}}."
  [graph source]
  (loop [queue (set (keys graph))
         dist (assoc (zipmap (keys graph) (repeat Long/MAX_VALUE)) source 0)
         prev {}]
    (if (empty? queue)
      {:dist dist :prev prev}
      (let [u (apply min-key #(get dist % Long/MAX_VALUE) queue)
            queue (disj queue u)
            edges (neighbors graph u)
            [dist prev] (reduce (fn [[d p] edge] (relax-edge d p u edge)) [dist prev] edges)]
        (recur queue dist prev)))))

(defn shortest-path
  [graph source target]
  (let [{:keys [dist prev]} (dijkstra graph source)
        d (get dist target Long/MAX_VALUE)]
    (if (= d Long/MAX_VALUE)
      {:distance nil :path []}
      (loop [path [target]
             cur target]
        (if (= cur source)
          {:distance d :path (vec (reverse path))}
          (recur (conj path (get prev cur)) (get prev cur)))))))
