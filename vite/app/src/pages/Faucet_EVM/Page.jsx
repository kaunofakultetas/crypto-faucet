import React, { useCallback, useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Web3 from 'web3'
import QRCode from 'react-qr-code'
import axios from 'axios'

/* MUI components */
import { Button, Box, Skeleton, Paper, Stack } from '@mui/material'

/* Icons */
import HubIcon from '@mui/icons-material/Hub'

/* Components */
import ProgressStepper from './components/ProgressStepper'
import ClaimButton from './components/ClaimButton'
import Alert from './components/Alert'



 
/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */
const FaucetInterface = () => {
  const { network } = useParams()
  const navigate = useNavigate()

  /* -------- remote data -------- */
  const [networkInfo, setNetworkInfo] = useState()      // fetched from /api/evm/networks
  const [faucetInfo,  setFaucetInfo]  = useState()      // fetched from /api/evm/{network}/faucet-balance

  /* -------- wallet / on-chain -------- */
  const [web3,         setWeb3]         = useState()
  const [account,      setAccount]      = useState(null)
  const [chainId,      setChainId]      = useState(null)
  const [userBalance,  setUserBalance]  = useState(null)

  /* -------- faucet status -------- */
  const [faucetAddress, setFaucetAddress] = useState('')
  const [chunkSize,     setChunkSize]     = useState(0)
  const [faucetBalance, setFaucetBalance] = useState(0)

  /* -------- UI state -------- */
  const [activeStep, setActiveStep] = useState(0)
  const [alerts,     setAlerts]     = useState([])




  /* ----------------------------------------------------------------
   *  Fetch network & faucet meta-data
   * ---------------------------------------------------------------- */
  useEffect(() => {
    let ignore = false

    const load = async () => {
      try {
        const { data } = await axios.get('/api/evm/networks')
        const info = data.networks?.[network]
        if (!ignore) setNetworkInfo(info)
      } catch (err) {
        console.error('Unable to load network list', err)
      }
    }

    load()
    return () => { ignore = true }
  }, [network])

  /* once we know which network we are on -> fetch faucet info (and poll) */
  useEffect(() => {
    if (!networkInfo) return

    const load = async () => {
      try {
        const { data } = await axios.get(`/api/evm/${network}/faucet-balance`)
        setFaucetInfo(data)
      } catch (err) {
        console.error('Unable to load faucet info', err)
      }
    }

    load()
    const id = setInterval(load, 3000)      // refresh every 3 s
    return () => clearInterval(id)
  }, [networkInfo, network])

  /* keep derived faucet state in sync */
  useEffect(() => {
    if (!faucetInfo) return
    setFaucetAddress(faucetInfo.address.toLowerCase())
    setChunkSize(faucetInfo.chunk_size)
    setFaucetBalance(faucetInfo.balance)
  }, [faucetInfo])




  /* ----------------------------------------------------------------
   *  Metamask / wallet handling
   * ---------------------------------------------------------------- */
  useEffect(() => {
    if (!window.ethereum) return

    const w3 = new Web3(window.ethereum)
    setWeb3(w3)

    const handleAccountsChanged = (acc) => setAccount(acc[0] ?? null)
    const handleChainChanged    = (id)  => setChainId(w3.utils.hexToNumber(id))

    window.ethereum.on('accountsChanged', handleAccountsChanged)
    window.ethereum.on('chainChanged',  handleChainChanged)

    w3.eth.getAccounts().then(handleAccountsChanged)
    w3.eth.getChainId().then((id) => setChainId(Number(id)))

    return () => {
      window.ethereum.removeListener('accountsChanged', handleAccountsChanged)
      window.ethereum.removeListener('chainChanged',  handleChainChanged)
    }
  }, [])

  /* refresh user balance (poll every second) */
  const fetchUserBalance = useCallback(async () => {
    if (!web3 || !account || !networkInfo) {
      setUserBalance(null)
      return
    }

    try {
      const currentId = await web3.eth.getChainId()
      if (Number(currentId) !== Number(networkInfo.chain_id)) {
        setUserBalance(null)                         // wrong chain
        return
      }
      const bal = await web3.eth.getBalance(account)
      setUserBalance(bal)
    } catch (err) {
      console.error('Unable to fetch user balance', err)
      setUserBalance(null)
    }
  }, [web3, account, networkInfo])

  useEffect(() => {
    fetchUserBalance()
    const id = setInterval(fetchUserBalance, 1000)
    return () => clearInterval(id)
  }, [fetchUserBalance])

  /* active step indicator */
  useEffect(() => {
    if (!networkInfo) return
    if (!account)                                  setActiveStep(1)
    else if (chainId !== networkInfo.chain_id)     setActiveStep(2)
    else                                           setActiveStep(3)
  }, [account, chainId, networkInfo])




  /* ----------------------------------------------------------------
   *  Helpers
   * ---------------------------------------------------------------- */
  const addAlert = useCallback((severity, message) => {
    const id = Date.now()
    setAlerts((prev) => [...prev, { id, severity, message, opacity: 1 }])

    setTimeout(() => {
      setAlerts((prev) => prev.map(a => a.id === id ? { ...a, opacity: 0 } : a))
      setTimeout(() => {
        setAlerts((prev) => prev.filter(a => a.id !== id))
      }, 500)
    }, 8000)
  }, [])

  const formatBalance = (bal) => {
    if (bal == null) return 'Loading…'
    if (!web3)       return '-'
    return `${parseFloat(web3.utils.fromWei(bal, 'ether')).toFixed(3)} ${networkInfo.short_name}`
  }



  /* ----------------------------------------------------------------
   *  Early loading guard -> skeleton layout
   * ---------------------------------------------------------------- */
  if (!networkInfo || !faucetInfo) {
    return (
      <Box className="p-4">
        <div className="mx-auto w-full min-w-[320px] max-w-[560px] px-4 pt-4">
          <Skeleton variant="text" height={48} width="70%" />
          <Skeleton variant="text" height={20} width="90%" />
        </div>

        <div className="card-surface mx-auto my-4 w-full min-w-[320px] max-w-[560px] p-4 shadow-card">
          <Skeleton variant="rectangular" height={60} />
        </div>

        <div className="card-surface mx-auto my-4 w-full min-w-[320px] max-w-[560px] p-4 shadow-card">
          <Stack spacing={2}>
            <Skeleton variant="text" height={28} />
            <Skeleton variant="text" height={28} />
            <Skeleton variant="text" height={28} />
            <Skeleton variant="rectangular" height={40} />
          </Stack>
        </div>

        <div className="card-surface mx-auto mb-5 w-full min-w-[320px] max-w-[560px] p-4 shadow-card">
          <Stack direction="row" spacing={2} alignItems="center">
            <Box sx={{ flex: 1 }}>
              <Skeleton variant="text" height={24} width="50%" />
              <Skeleton variant="text" height={20} width="80%" />
            </Box>
            <Skeleton variant="rectangular" height={128} width={128} />
          </Stack>
        </div>
      </Box>
    )
  }




  /* ----------------------------------------------------------------
   *  Render
   * ---------------------------------------------------------------- */
  return (
    <Box className="p-4">

      {/* Title and description */}
      <div className="mx-auto w-full min-w-[320px] max-w-[560px] px-4 pt-4">
        <h1 className="mb-3 text-[45px] font-bold text-[#78003F]">
          {networkInfo.full_name} ETH faucet&apos;as
        </h1>
        <p className="text-sm text-gray-700">
          Šiuo įrankiu galite gauti <u>{networkInfo.full_name}</u> ETH testinės kriptovaliutos laboratoriniams darbams.
        </p>
      </div>


      {/* Progress Stepper */}
      <div className="card-surface mx-auto my-4 w-full min-w-[320px] max-w-[560px] p-4 shadow-card">
        <ProgressStepper activeStep={activeStep} networkName={networkInfo.full_name} />
      </div>


      {/* Balances, claim button, alerts */}
      <div className="card-surface mx-auto my-4 w-full min-w-[320px] max-w-[560px] p-4 shadow-card">

        {/* User and faucet balance */}
        <div className="my-2 flex">
          <span className="flex-1">Jūsų Metamask balansas:</span>
          <span className="text-right">{activeStep === 3 ? formatBalance(userBalance) : (networkInfo ? 'Piniginė neprijungta' : '--.--')}</span>
        </div>
        <div className="my-2 flex">
          <span className="flex-1">Išsiųsime jums:</span>
          <span className="text-right">{networkInfo && faucetInfo ? `${parseFloat(chunkSize).toFixed(3)} ${networkInfo.short_name}` : '--.--'}</span>
        </div>
        <div className="my-2 flex">
          <span className="flex-1">Čiaupo balansas:</span>
          <span className="text-right">{networkInfo && faucetInfo ? `${parseFloat(faucetBalance).toFixed(3)} ${networkInfo.short_name}` : '--.--'}</span>
        </div>

        {/* Claim button */}
        <div className="mt-3">
          <ClaimButton
            network={network}
            chainId={networkInfo.chain_id}
            onSuccess={() => addAlert('success', `${networkInfo.full_name} išsiųstas į jūsų piniginę.`)}
            onError={(e) => addAlert('error', e)}
            setActiveStep={setActiveStep}
          />
        </div>

        {/* Alerts */}
        {alerts.map(a => (
          <Alert key={a.id} severity={a.severity} style={{ opacity: a.opacity }}>
            {a.message}
          </Alert>
        ))}
      </div>


      {/* Crypto return address and transaction flow */}
      <div className="card-surface mx-auto mb-5 w-full min-w-[320px] max-w-[560px] p-4 shadow-card">
        <div className="my-2 flex items-start gap-4">
          <span className="flex-1">
            Grąžinkite nebereikalingą <u><b>{networkInfo.short_name}</b></u> krypto atgal:
            <br /><br />{faucetAddress}
            <br /><br />
            <Button
              variant="contained"
              onClick={() => navigate(`/graph/${network}`)}
              startIcon={<HubIcon />}
              sx={{ padding: '10px 16px' }}
            >
              Transakcijų srautas
            </Button>
          </span>
          <QRCode value={faucetAddress} size={128} />
        </div>
      </div>


    </Box>
  )
}

export default FaucetInterface