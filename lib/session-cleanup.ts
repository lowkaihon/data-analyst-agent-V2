// Client-side session management utilities

export function initSessionCleanup() {
  // Store dataset ID in sessionStorage
  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", () => {
      // Optionally trigger cleanup on page close
      const datasetId = sessionStorage.getItem("currentDatasetId")
      if (datasetId) {
        // Send beacon to cleanup endpoint
        navigator.sendBeacon("/api/datasets/cleanup", JSON.stringify({ datasetId }))
      }
    })
  }
}

export function setCurrentDataset(datasetId: string) {
  if (typeof window !== "undefined") {
    sessionStorage.setItem("currentDatasetId", datasetId)
  }
}

export function getCurrentDataset(): string | null {
  if (typeof window !== "undefined") {
    return sessionStorage.getItem("currentDatasetId")
  }
  return null
}

export function clearCurrentDataset() {
  if (typeof window !== "undefined") {
    sessionStorage.removeItem("currentDatasetId")
  }
}
