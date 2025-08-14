/**
 * Utility functions for the Graph visualization system
 * Reusable helper functions for data processing and time calculations
 */

/**
 * Calculates human-readable time difference from a given date to now
 * @param {Date} date - The date to calculate difference from
 * @returns {string} Human-readable time difference (e.g., "5 minutes ago")
 */
export const timeSince = (date) => {
  const seconds = Math.floor((new Date() - date) / 1000);
  let interval = seconds / 31536000; // seconds in a year

  if (interval > 1) {
    return Math.floor(interval) + " years ago";
  }
  interval = seconds / 2592000; // seconds in a month
  if (interval > 1) {
    return Math.floor(interval) + " months ago";
  }
  interval = seconds / 86400; // seconds in a day
  if (interval > 1) {
    return Math.floor(interval) + " days ago";
  }
  interval = seconds / 3600; // seconds in an hour
  if (interval > 1) {
    return Math.floor(interval) + " hours ago";
  }
  interval = seconds / 60; // seconds in a minute
  if (interval > 1) {
    return Math.floor(interval) + " minutes ago";
  }
  return Math.floor(seconds) + " seconds ago";
};

/**
 * Filters transactions by time threshold
 * @param {Array} transactions - Array of transaction objects
 * @param {number} timescale - Time threshold in hours
 * @returns {Array} Filtered transactions within the time threshold
 */
export const filterTransactionsByTime = (transactions, timescale) => {
  const now = new Date();
  const thresholdTime = new Date(now.getTime() - timescale * 60 * 60 * 1000);

  return transactions.filter(tx => {
    const txTime = new Date(tx.to_timestamp);
    return txTime >= thresholdTime;
  });
};

/**
 * Safely converts timestamp to Date object, handling both string and number formats
 * @param {string|number} timestamp - The timestamp to convert
 * @returns {Date} Date object or current date as fallback
 */
export const parseTimestamp = (timestamp) => {
  if (typeof timestamp === 'string' || timestamp instanceof String) {
    return new Date(timestamp);
  } else if (typeof timestamp === 'number') {
    return new Date(timestamp * 1000); // Convert seconds to milliseconds
  } else {
    console.error('Unrecognized timestamp format:', timestamp);
    return new Date(); // Fallback to current time
  }
};

/**
 * Formats an address for display (first 6 + last 4 characters)
 * @param {string} address - The full address
 * @returns {string} Shortened address format
 */
export const formatAddress = (address) => {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

/**
 * Creates a formatted transaction label for edges
 * @param {number} value - Transaction value in ETH
 * @param {number} count - Number of transactions
 * @returns {string} Formatted label for the edge
 */
export const formatTransactionLabel = (value, count) => {
  return `${value.toFixed(4)} ETH\n(${count} tx${count > 1 ? 's' : ''})`;
};

/**
 * Extracts name from node label if present (first line)
 * @param {string} label - The full node label
 * @returns {string} Extracted name or empty string
 */
export const extractNameFromLabel = (label) => {
  if (!label || typeof label !== 'string') return '';
  
  const lines = label.split('\n');
  const firstLine = (lines[0] || '').trim();
  
  // If first line looks like an address (starts with 0x), treat as no name
  if (firstLine && !/^0x/i.test(firstLine)) {
    return firstLine;
  }
  
  return '';
};

/**
 * Preserves the "Updated: ..." suffix from existing node labels
 * @param {string} existingLabel - The current node label
 * @returns {string} The "Updated: ..." suffix or empty string
 */
export const preserveUpdatedSuffix = (existingLabel) => {
  if (!existingLabel || typeof existingLabel !== 'string') return '';
  
  const lines = existingLabel.split('\n');
  const secondLine = (lines[1] || '').trim();
  
  if (secondLine.toLowerCase().startsWith('updated:')) {
    return `\n${secondLine}`;
  }
  
  return '';
};

/**
 * Clamps a value between min and max bounds
 * @param {number} value - Value to clamp
 * @param {number} min - Minimum bound
 * @param {number} max - Maximum bound
 * @returns {number} Clamped value
 */
export const clamp = (value, min, max) => {
  return Math.max(min, Math.min(max, value));
};

/**
 * Safely copies text to clipboard
 * @param {string} text - Text to copy
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
export const copyToClipboard = async (text) => {
  try {
    await navigator.clipboard.writeText(text || '');
    return true;
  } catch (error) {
    console.error('Failed to copy to clipboard:', error);
    return false;
  }
};
