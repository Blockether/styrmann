(ns algorithms.interval)

(defn merge-intervals
  "Merge overlapping [start end] intervals."
  [intervals]
  (let [sorted (sort-by first intervals)]
    (reduce (fn [acc [s e]]
              (if (empty? acc)
                [[s e]]
                (let [[ls le] (peek acc)]
                  (if (<= s le)
                    (conj (pop acc) [ls (max le e)])
                    (conj acc [s e])))))
            []
            sorted)))
