import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { useParams } from 'react-router-dom'
import axios from 'axios'
import QRCode from 'react-qr-code'

/* MUI components */
import { Box, Paper, TextField, Button, Alert, Stack, Typography, Divider, Skeleton, Chip } from '@mui/material'


 
/* ------------------------------------------------------------------ */
/*  Simplified UTXO Faucet (e.g., Bitcoin testnet)                    */
/* ------------------------------------------------------------------ */
const FaucetInterface = () => {
  const { network } = useParams()
  const isMountedRef = useRef(true)

  /* -------- network metadata (names from backend config) -------- */
  const [netMeta, setNetMeta] = useState({ short_name: 'BTC', full_name: 'Bitcoin' })

  /* -------- remote faucet data -------- */
  const [faucetInfo, setFaucetInfo] = useState(null) // { balance, address, chunk_size } | { error }
  const [loadingInfo, setLoadingInfo] = useState(true)
  const [initialLoad, setInitialLoad] = useState(true)

  /* -------- request state -------- */
  const [recipient, setRecipient] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(null) // { txid, amount, network }
  const [error, setError] = useState(null)     // string

  const currencyShort = netMeta?.short_name || 'BTC'
  const currencyFull  = netMeta?.full_name || 'Bitcoin'

  

  // Memoized balance display values to prevent flickering
  const balanceDisplay = useMemo(() => {
    if (!faucetInfo || faucetInfo.error) return null
    
    const total = Number(faucetInfo.balance || 0)
    const confirmed = Number(faucetInfo.balance_confirmed || 0)
    const unconfirmed = Number(faucetInfo.balance_unconfirmed || 0)
    const chunkSize = Number(faucetInfo.chunk_size || 0)

    return {
      total: total.toFixed(3),
      confirmed: confirmed.toFixed(3),
      unconfirmed: unconfirmed.toFixed(3),
      chunkSize: chunkSize.toFixed(3),
      hasUnconfirmed: unconfirmed > 0
    }
  }, [faucetInfo])

  // Load network metadata (short_name/full_name) once per route change
  useEffect(() => {
    let ignore = false
    const loadMeta = async () => {
      try {
        const { data } = await axios.get('/api/utxo/networks')
        const info = data?.networks?.[network]
        if (!ignore && info) setNetMeta({ short_name: info.short_name || 'BTC', full_name: info.full_name || 'Bitcoin' })
      } catch (_) {
        /* keep defaults */
      }
    }
    loadMeta()
    return () => { ignore = true }
  }, [network])

  // Immediately clear stale UI when network changes
  useEffect(() => {
    setFaucetInfo(null)
    setLoadingInfo(true)
    setInitialLoad(true)
    setSuccess(null)
    setError(null)
  }, [network])

  const loadFaucetInfo = useCallback(async (isRefresh = false) => {
    if (!isMountedRef.current) return
    
    try {
      if (!isRefresh) setLoadingInfo(true)
      const { data } = await axios.get(`/api/utxo/${network}/faucet-balance`)
      if (isMountedRef.current) {
        setFaucetInfo(data)
      }
    } catch (e) {
      if (isMountedRef.current) {
        setFaucetInfo({ error: 'Nepavyko gauti čiaupo informacijos' })
      }
    } finally {
      if (isMountedRef.current) {
        setLoadingInfo(false)
        if (initialLoad) setInitialLoad(false)
      }
    }
  }, [network, initialLoad])




  useEffect(() => {
    isMountedRef.current = true
    
    // Initial load
    loadFaucetInfo(false)
    
    // Background refresh every 5 seconds
    const id = setInterval(() => {
      if (isMountedRef.current) {
        loadFaucetInfo(true) // Silent refresh
      }
    }, 5000)
    
    return () => {
      isMountedRef.current = false
      clearInterval(id)
    }
  }, [loadFaucetInfo])

  const validateAddress = (addr) => {
    const a = (addr || '').toLowerCase().trim()
    // Accept common prefixes; backend will enforce exact network
    return a.startsWith('tb1') || a.startsWith('bcrt1') || a.startsWith('bc1')
  }



  const handleRequest = async () => {
    setSuccess(null)
    setError(null)
    const addr = recipient.trim()
    if (!validateAddress(addr)) {
      setError(`Neteisingas ${currencyShort} adresas (tik b[c|crt|t]1… Bech32)`) 
      return
    }
    try {
      setSubmitting(true)
      const { data } = await axios.get(`/api/utxo/${network}/request-btc`, { params: { address: addr } })
      if (data?.error) {
        setError(data.error)
      } else {
        setSuccess({ txid: data.transaction_id, amount: data.amount, chain: data.network })
        setRecipient('')
        // refresh balance after successful send
        loadFaucetInfo(false)
      }
    } catch (e) {
      // Handle HTTP error responses (4xx, 5xx)
      if (e.response?.data?.error) {
        const errorMsg = e.response.data.error
        const details = e.response.data.details
        if (details) {
          setError(`${errorMsg}\n\nDetalės: ${details}`)
        } else {
          setError(errorMsg)
        }
      } else if (e.response?.status === 429) {
        setError('Per daug užklausų. Palaukite ir bandykite vėl.')
      } else if (e.response?.status >= 400) {
        setError(`Serverio klaida (${e.response.status}): ${e.response.data?.error || 'Nežinoma klaida'}`)
      } else {
        setError('Nepavyko išsiųsti kriptovaliutos. Patikrinkite interneto ryšį.')
      }
    } finally {
      setSubmitting(false)
    }
  }




  return (
    <Box className="p-4">
      <Box className="mx-auto w-full min-w-[320px] max-w-[560px] px-4 pt-4">
        <Typography variant="h3" sx={{ fontWeight: 800, color: '#78003F', mb: 1.5, fontSize: 36 }}>
          {currencyFull} faucet&apos;as
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Šiuo įrankiu galite gauti <u>{currencyFull}</u> testinės kriptovaliutos laboratoriniams darbams.
        </Typography>
      </Box>

      <Paper elevation={0} className="card-surface mx-auto my-4 w-full min-w-[320px] max-w-[560px] p-4">
        <Stack spacing={2}>
          {initialLoad && loadingInfo ? (
            <Stack spacing={2}>
              <Skeleton variant="text" height={40} />
              <Skeleton variant="text" height={40} />
            </Stack>
          ) : faucetInfo?.error ? (
            <Alert severity="error">{faucetInfo.error}</Alert>
          ) : balanceDisplay ? (
            <>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <Typography sx={{ flex: 1 }}>Išsiųsime jums:</Typography>
                <Typography>{balanceDisplay.chunkSize} {currencyShort}</Typography>
              </Box>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <Typography sx={{ flex: 1 }}>Čiaupo balansas:</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography>{balanceDisplay.total} {currencyShort}</Typography>
                    {balanceDisplay.hasUnconfirmed}
                </Box>
              </Box>
            </>
          ) : null}

          {success ? (
            <Alert severity="success">
              Išsiųsta {success.amount} {currencyShort}. Transakcija: {success.txid}
            </Alert>
          ) : null}
          {error ? (
            <Alert severity="error" sx={{ whiteSpace: 'pre-wrap' }}>
              {error}
            </Alert>
          ) : null}

          <Divider />

          <TextField
            label={`Jūsų ${currencyShort} adresas`}
            placeholder="pvz. tb1q…"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            fullWidth
          />
            <Button
              variant="contained"
            onClick={handleRequest}
            disabled={
              submitting ||
              (initialLoad && loadingInfo) ||
              !!faucetInfo?.error ||
              recipient.trim().length === 0
            }
            sx={{ 
              minHeight: 42,
              position: 'relative'
            }}
          >
            {recipient.trim().length === 0
              ? 'ĮKLIJUOKITE ADRESĄ'
              : (submitting ? 'Siunčiama…' : `Gauti ${currencyShort}`)}
            </Button>
        </Stack>
      </Paper>

      {!initialLoad && faucetInfo && !faucetInfo.error ? (
        <Paper elevation={0} className="card-surface mx-auto mb-5 w-full min-w-[320px] max-w-[560px] p-4">
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
            <Box sx={{ flex: 1 }}>
              <Typography>
                Grąžinkite nebereikalingą <b>{currencyShort}</b> atgal:
              </Typography>
              <Typography sx={{ mt: 1.5, wordBreak: 'break-all', fontFamily: 'monospace', fontSize: '0.875rem' }}>
                {faucetInfo.address}
              </Typography>
            </Box>
            {faucetInfo.address && (
              <QRCode value={faucetInfo.address} size={128} />
            )}
          </Box>
        </Paper>
      ) : initialLoad && loadingInfo ? (
        <Paper elevation={0} className="card-surface mx-auto mb-5 w-full min-w-[320px] max-w-[560px] p-4">
          <Skeleton variant="text" height={30} width="60%" />
          <Skeleton variant="text" height={20} sx={{ mt: 1.5 }} />
        </Paper>
      ) : null}
    </Box>
  )
}

export default FaucetInterface