import React from 'react';
import { Box, Typography, Card, CardContent } from '@mui/material';

export default function VideosPage() {
  return (
    <Box className="flex justify-center min-h-[calc(100vh-105px)] p-8">
      <Box className="max-w-4xl w-full">
        <Typography 
          variant="h3" 
          component="h1" 
          className="text-center pb-8"
          sx={{ color: 'var(--color-primary)', fontWeight: 'bold' }}
        >
          Vaizdo Įrašai
        </Typography>
        
        


        {/* Video Section */}
        <Box className="space-y-8">

          {/* Replace by Fee */}
          <Card className="shadow-lg">
            <CardContent className="p-6">
              <Typography 
                variant="h5" 
                component="h2" 
                className="mb-4"
                sx={{ color: 'var(--color-primary)', fontWeight: 'bold' }}
              >
                Dvigubo apmokėjimo ataka naudojant Replace by Fee (RBF)
              </Typography>
              
              <Typography 
                variant="body1" 
                className="text-gray-600 pb-4 pt-2"
              >
                Replace by Fee (RBF) yra mechanizmas, kuris leidžia vartotojams pakeisti transakciją. Šis 
                mechanizmas buvo sukurtas tam jog kriptovaliutos naudojai galėtų atnaujinti užstrigusias transakcijas
                ir pakelti transakcijos mokomą mokestį kasėjams taip paspartinant transakcijos patvirtinimą
                blokų grandinėje.

              </Typography>
              
              <Box className="w-full">
                <video 
                  className="w-full max-w-full rounded-lg shadow-md"
                  controls
                  preload="metadata"
                  style={{ maxHeight: '500px' }}
                >
                  <source src="/served/videos/01.ReplaceByFee.mp4" type="video/mp4" />
                  Jūsų naršyklė nepalaiko video elemento.
                </video>
              </Box>
            </CardContent>
          </Card>


          {/* Mining Fork Resolution */}
          <Card className="shadow-lg">
            <CardContent className="p-6">
              <Typography 
                variant="h5" 
                component="h2" 
                className="mb-4"
                sx={{ color: 'var(--color-primary)', fontWeight: 'bold' }}
              >
                Blokų Grandinės Skylimas (Natūralus)
              </Typography>
              
              <Typography 
                variant="body1" 
                className="text-gray-600 pb-4 pt-2"
              >
                Kriptovaliutos grandinės skylimas (natūralus) yra procesas, kai panašiu laiku yra iškasami
                du blokai tinkle šie blokai yra propaguojami visame tinkle. Blokų grandinės dalyviai toliau 
                tęsia ir bando iškasti naują bloką ant to kurį gavo pirmiau. Kai yra atrandamas 
                tolimesnis blokas šis blokas taip pat yra paviešinamas visame tinkle ir tie dalyviai kurie 
                buvo kitoje atšakoje persioriantuoja ir tęsia darbus ilgiausioje grandinėje.
              </Typography>
              
              <Box className="w-full">
                <video 
                  className="w-full max-w-full rounded-lg shadow-md"
                  controls
                  preload="metadata"
                  style={{ maxHeight: '500px' }}
                >
                  <source src="/served/videos/05.MiningForkResolution.mp4" type="video/mp4" />
                  Jūsų naršyklė nepalaiko video elemento.
                </video>
              </Box>
            </CardContent>
          </Card>





        </Box>
      </Box>
    </Box>
  );
}