import React, { useEffect, useState } from 'react'
import axios from 'axios'
import { useParams } from 'react-router-dom'

import { CryptoFlowGraph } from './components'

/**
 * GraphPage - Main page component for the transaction flow visualization
 * 
 * Responsible for:
 * - Extracting network parameter from URL
 * - Fetching the faucet address for the selected network
 * - Handling loading and error states
 * - Rendering the CryptoFlowGraph component with proper data
 * 
 * @returns {React.Component} The graph page with loading/error handling
 */
const GraphPage = () => {
  // Extract network identifier from URL parameters
  const { network } = useParams()
  
  // State management for faucet address loading
  const [address, setAddress] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Load faucet address for the selected network
  useEffect(() => {
    if (!network) return
    
    let ignore = false // Prevent state updates if component unmounts
    
    const loadFaucetAddress = async () => {
      try {
        setLoading(true)
        const { data } = await axios.get(`/api/evm/${network}/faucet-balance`)
        if (!ignore) setAddress(data.address)
      } catch (error) {
        console.error('Failed to fetch faucet address:', error)
        if (!ignore) setError('Nepavyko gauti čiaupo adreso')
      } finally {
        if (!ignore) setLoading(false)
      }
    }
    
    loadFaucetAddress()
    return () => { ignore = true }
  }, [network])

  // Render loading state
  if (loading) {
    return <div className="p-4 text-center">Kraunama…</div>
  }
  
  // Render error state
  if (error) {
    return <div className="p-4 text-center text-red-600">{error}</div>
  }
  
  // Render empty state
  if (!address) {
    return <div className="p-4 text-center">Adresas nerastas</div>
  }

  return (
    <div className="p-4">
      <CryptoFlowGraph faucetAddress={address} network={network} />
    </div>
  )
}

export default GraphPage


