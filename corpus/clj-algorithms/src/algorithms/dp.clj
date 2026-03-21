(ns algorithms.dp)

(defn edit-distance
  "Levenshtein distance."
  [a b]
  (let [n (count a)
        m (count b)
        init (vec (range (inc m)))]
    (first
     (reduce (fn [prev i]
               (reduce (fn [row j]
                         (let [cost (if (= (nth a (dec i)) (nth b (dec j))) 0 1)
                               deletion (inc (nth prev j))
                               insertion (inc (peek row))
                               substitution (+ (nth prev (dec j)) cost)]
                           (conj row (min deletion insertion substitution))))
                       [i]
                       (range 1 (inc m))))
             init
             (range 1 (inc n))))))
