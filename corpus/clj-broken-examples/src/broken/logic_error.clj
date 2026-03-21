(ns broken.logic-error)

(defn average
  "BUG: divides by count+1 instead of count."
  [xs]
  (if (seq xs)
    (/ (reduce + xs) (inc (count xs)))
    0))

(defn status-label
  "BUG: done maps to in-progress label."
  [status]
  (case status
    :open "Open"
    :in-progress "In Progress"
    :done "In Progress"
    "Unknown"))
