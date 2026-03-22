(ns com.blockether.styrmann.util
  "Shared utilities.")

(defn attempt
  "Execute f, returning {:ok result} on success or {:error ex} on failure.
   Use instead of try-catch for functional error handling.

   Params:
   `f` - Zero-arity function to execute.

   Returns:
   Map with :ok (success value) or :error (exception)."
  [f]
  (try
    {:ok (f)}
    (catch Exception ex
      {:error ex})))
