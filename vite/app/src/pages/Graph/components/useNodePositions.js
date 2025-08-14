import { useCallback, useEffect, useRef } from 'react'
import { LAYOUT_CONFIG, STORAGE_KEYS } from '../constants'

/**
 * Custom hook for managing node position persistence in the graph
 * 
 * Handles saving/loading node X positions to/from localStorage and provides
 * utilities for level-based horizontal positioning. This ensures that manually
 * positioned nodes stay in place across page refreshes and graph updates.
 * 
 * @param {string} networkKey - Unique identifier for the network (used in storage key)
 * @returns {Object} Hook interface with position management functions
 */
export const useNodePositions = (networkKey) => {
  // Maps: address -> x coordinate (only X is persisted, Y is handled by layout)
  const positionsRef = useRef(new Map())
  // Maps: level -> lastUsedX (for spacing new nodes horizontally)
  const levelsRef = useRef(new Map())

  const storageKey = `${STORAGE_KEYS.NODE_POSITIONS_PREFIX}${networkKey}`

  /**
   * Loads saved node positions from localStorage
   * Populates the positionsRef map with address -> x coordinate mappings
   */
  const load = useCallback(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) return
      const obj = JSON.parse(raw)
      Object.entries(obj).forEach(([address, xPosition]) => {
        const x = Number(xPosition)
        if (!Number.isNaN(x)) positionsRef.current.set(address, x)
      })
    } catch (error) {
      console.warn('Failed to load node positions from localStorage:', error)
    }
  }, [storageKey])

  /**
   * Saves current node positions to localStorage
   * Only saves address -> x mappings (filters out level tracking entries)
   */
  const save = useCallback(() => {
    try {
      const obj = {}
      positionsRef.current.forEach((x, key) => {
        // Only save address mappings (strings), skip level tracking (numbers)
        if (typeof key === 'string' && typeof x === 'number') {
          obj[key] = x
        }
      })
      localStorage.setItem(storageKey, JSON.stringify(obj))
    } catch (error) {
      console.warn('Failed to save node positions to localStorage:', error)
    }
  }, [storageKey])

  useEffect(() => {
    load()
  }, [load])

  /**
   * Gets the next horizontal position for a node at the specified level
   * Ensures nodes at the same level don't overlap horizontally
   * @param {number} level - The hierarchy level
   * @returns {number} X coordinate for the next node at this level
   */
  const setLevelNextX = (level) => {
    const lastX = levelsRef.current.get(level) || 0
    const nextX = lastX + LAYOUT_CONFIG.NODE_HORIZONTAL_INCREMENT
    levelsRef.current.set(level, nextX)
    return nextX
  }

  return {
    /** Ref to Map storing address -> x position */
    positionsRef,
    /** Ref to Map storing level -> lastUsedX */
    levelsRef,
    /** Function to load positions from localStorage */
    load,
    /** Function to save positions to localStorage */
    save,
    /** Function to get next X position for a level */
    setLevelNextX,
  }
}


