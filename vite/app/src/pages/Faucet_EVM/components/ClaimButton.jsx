import React, { useEffect, useState }   from 'react'
import { Button }                       from '@mui/material'
import CircularProgress                 from '@mui/material/CircularProgress'
import Web3                              from 'web3'

/**
 * Props:
 *   network       – short network key (e.g. `sepolia`)
 *   onSuccess     – called after ETH was sent successfully
 *   onError       – called with an error message on failure
 *   setActiveStep – helper for the stepper in the parent component
 */
const ClaimButton = ({ network, onSuccess, onError, setActiveStep }) => {
  /* ------------------------------------------------------------------ */
  /*  Local state                                                        */
  /* ------------------------------------------------------------------ */
  const [account,        setAccount]        = useState(null)
  const [web3,           setWeb3]           = useState(null)
  const [isLoading,      setIsLoading]      = useState(false)
  const [installed,      setInstalled]      = useState(false)
  const [currentChainId, setCurrentChainId] = useState(null)
  const [networkConfig,  setNetworkConfig]  = useState(null)

  /* ------------------------------------------------------------------ */
  /*  Detect MetaMask + basic listeners                                  */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    if (!window?.ethereum) return                       // MetaMask not installed

    setInstalled(true)
    const w3 = new Web3(window.ethereum)
    setWeb3(w3)

    /* initial values */
    window.ethereum.request({ method: 'eth_accounts' })
      .then((acc) => acc && acc.length && setAccount(acc[0]))

    window.ethereum.request({ method: 'eth_chainId' })
      .then((id) => setCurrentChainId(parseInt(id, 16)))

    /* listeners */
    const handleAccountsChanged = (acc) => setAccount(acc[0] ?? null)
    const handleChainChanged    = (id)  => setCurrentChainId(parseInt(id, 16))

    window.ethereum.on('accountsChanged', handleAccountsChanged)
    window.ethereum.on('chainChanged',  handleChainChanged)

    return () => {
      window.ethereum.removeListener('accountsChanged', handleAccountsChanged)
      window.ethereum.removeListener('chainChanged',  handleChainChanged)
    }
  }, [])

  /* ------------------------------------------------------------------ */
  /*  Fetch faucet / network meta-data                                   */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    if (!network) return

    const load = async () => {
      try {
        const res  = await fetch('/api/evm/networks')
        const data = await res.json()
        if (!res.ok || !data.networks?.[network]) {
          throw new Error('Failed to fetch network configuration')
        }
        setNetworkConfig(data.networks[network])
      } catch (err) {
        console.error('Error fetching network configuration:', err)
        onError('Failed to fetch network configuration.')
      }
    }

    load()
  }, [network, onError])

  /* ------------------------------------------------------------------ */
  /*  Helpers                                                            */
  /* ------------------------------------------------------------------ */
  const switchNetwork = async () => {
    if (!networkConfig) {
      onError('Network configuration not available.')
      return
    }

    const chainIdHex = `0x${networkConfig.chain_id.toString(16)}`
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: chainIdHex }]
      })
    } catch (err) {
      /* chain not added -> try to add */
      if (err.code === 4902) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId:           chainIdHex,
              chainName:         networkConfig.full_name,
              nativeCurrency:    networkConfig.native_currency,
              rpcUrls:           networkConfig.rpc_urls,
              blockExplorerUrls: networkConfig.block_explorer_urls
            }]
          })
        } catch (addErr) {
          console.error('Failed to add network:', addErr)
          onError(`Failed to add network: ${addErr.message}`)
          return
        }
      } else {
        console.error('Failed to switch network:', err)
        onError(`Failed to switch network: ${err.message}`)
        return
      }
    }

    /* verify */
    try {
      const id = await window.ethereum.request({ method: 'eth_chainId' })
      if (id !== chainIdHex) {
        onError('Failed to switch to the correct network. Please check your MetaMask settings.')
      }
    } catch (checkErr) {
      console.error('Error checking current chain:', checkErr)
    }
  }

  const claimTestnetEth = async () => {
    setIsLoading(true)
    try {
      if (!web3 || !account) {
        setActiveStep?.(1)
        throw new Error('Metamask piniginė neprijungta.')
      }

      if (currentChainId !== networkConfig?.chain_id) {
        throw new Error(`Please switch to the ${networkConfig?.full_name} network before claiming.`)
      }

      const nonce    = Date.now().toString()
      const message  = `Pasirašykite žinutę kad patvirtintumėte jog naudojate šią piniginę. Nonce: ${nonce}`
      const signature = await web3.eth.personal.sign(message, account, '')

      const params = new URLSearchParams({ address: account, signature, nonce })
      const url    = `/api/evm/${network}/request-eth?${params.toString()}`

      const res  = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Nepavyko išsiųsti ${network} ETH`)

      onSuccess()
    } catch (e) {
      console.error('Error in claimTestnetEth:', e)
      onError(e.message || 'An unexpected error occurred. Please try again later.')
    } finally {
      setIsLoading(false)
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Render                                                             */
  /* ------------------------------------------------------------------ */
  if (!installed) {
    setActiveStep?.(0)
    return (
      <Button
        component="a"
        href="https://metamask.io/download/"
        target="_blank"
        rel="noopener noreferrer"
        variant="contained"
        fullWidth
      >
        Sudiegti MetaMask
      </Button>
    )
  }

  if (isLoading) {
    return (
      <Button variant="contained" fullWidth disabled sx={{ minHeight: 40, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress size={22} color="inherit" />
      </Button>
    )
  }

  if (!account) {
    setActiveStep?.(1)
    return (
      <Button
        variant="contained"
        fullWidth
        onClick={() =>
          window.ethereum
            .request({ method: 'eth_requestAccounts' })
            .then((acc) => acc.length && setAccount(acc[0]))
            .catch((e) => onError(e.message))
        }
      >
        Prijungti piniginę
      </Button>
    )
  }

  if (currentChainId !== networkConfig?.chain_id) {
    setActiveStep?.(2)
    return (
      <Button variant="contained" onClick={switchNetwork} fullWidth>
        Persijungti į {networkConfig?.full_name} ETH tinklą
      </Button>
    )
  }

  setActiveStep?.(3)
  return (
    <Button variant='contained' color='primary' onClick={claimTestnetEth} fullWidth>
      Gauti {networkConfig?.full_name || network} ETH valiutos
    </Button>
  )
}

export default ClaimButton
