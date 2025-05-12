const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const os = require('os');
const http = require('http');

// 로그 설정
let logFile;
let logStream;

app.whenReady().then(() => {
  // 로그 파일 경로 설정 (앱이 준비된 후)
  logFile = path.join(app.getPath('userData'), 'app.log');
  logStream = fs.createWriteStream(logFile, { flags: 'a' });

  // 콘솔 출력을 로그 파일로도 복제
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  console.log = function() {
    const args = Array.from(arguments);
    const timestamp = new Date().toISOString();
    const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
    logStream.write(`[${timestamp}] [LOG] ${message}\n`);
    originalConsoleLog.apply(console, arguments);
  };
  console.error = function() {
    const args = Array.from(arguments);
    const timestamp = new Date().toISOString();
    const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
    logStream.write(`[${timestamp}] [ERROR] ${message}\n`);
    originalConsoleError.apply(console, arguments);
  };
  
  console.log('앱 시작');
  createWindow();
});

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 1100,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  console.log('메인 윈도우 생성됨');
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Ollama 상태 확인 및 자동 실행 함수 (개선버전)
function checkAndStartOllama() {
  console.log('Ollama 상태 확인 시작');
  
  return new Promise((resolve) => {
    // 기본 상태 객체
    const status = {
      installed: false,
      running: false,
      autoStartFailed: false
    };
    
    // Mac 전용 경로 확인 (직접 경로 확인)
    if (os.platform() === 'darwin') {
      const commonPaths = [
        '/usr/local/bin/ollama',
        '/opt/homebrew/bin/ollama',
        '/usr/bin/ollama',
        '/opt/ollama/bin/ollama',
        `${os.homedir()}/homebrew/bin/ollama`
      ];
      
      for (const p of commonPaths) {
        try {
          if (fs.existsSync(p)) {
            console.log(`Ollama 설치 확인: ${p} 경로 발견`);
            status.installed = true;
            break;
          }
        } catch (err) {
          console.error(`경로 확인 오류 (${p}):`, err.message);
        }
      }
    }
    
    // 위 방법으로 설치 확인이 안 된 경우 which/where 명령 시도
    if (!status.installed) {
      const checkCommand = os.platform() === 'win32' ? 'where ollama' : 'which ollama';
      
      try {
        // PATH 환경변수 명시적 설정
        const env = Object.assign({}, process.env);
        if (os.platform() === 'darwin') {
          env.PATH = `/usr/local/bin:/opt/homebrew/bin:/usr/bin:${env.PATH || ''}`;
        }
        
        const result = require('child_process').execSync(checkCommand, { 
          encoding: 'utf8',
          env: env
        }).trim();
        
        if (result) {
          console.log(`Ollama 설치 확인 (${checkCommand}): ${result}`);
          status.installed = true;
        }
      } catch (error) {
        console.error(`${checkCommand} 명령 실패:`, error.message);
      }
    }
    
    // 설치되지 않은 경우 추가 확인 없이 반환
    if (!status.installed) {
      console.log('Ollama 설치되지 않음');
      resolve(status);
      return;
    }
    
    // 실행 상태 확인 - HTTP 요청
    console.log('Ollama 실행 상태 확인 중...');
    const checkRunning = () => {
      return new Promise((resolveCheck) => {
        const req = http.request({
          method: 'GET',
          hostname: 'localhost',
          port: 11434,
          path: '/api/version',
          timeout: 2000
        }, (res) => {
          console.log(`Ollama API 응답: ${res.statusCode}`);
          resolveCheck(res.statusCode === 200);
        });
        
        req.on('error', (err) => {
          console.log(`Ollama API 연결 오류: ${err.message}`);
          resolveCheck(false);
        });
        
        req.on('timeout', () => {
          console.log('Ollama API 연결 타임아웃');
          req.destroy();
          resolveCheck(false);
        });
        
        req.end();
      });
    };
    
    // API 요청으로 실행 상태 확인
    checkRunning().then(async (running) => {
      status.running = running;
      
      // 실행 중이지 않은 경우 자동 시작 시도
      if (!running) {
        console.log('Ollama 자동 시작 시도...');
        try {
          // 플랫폼별 실행 명령
          const serveCommand = os.platform() === 'darwin' 
            ? 'PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:$PATH ollama serve > /dev/null 2>&1 &' 
            : (os.platform() === 'win32' ? 'start /min cmd /c ollama serve' : 'nohup ollama serve > /dev/null 2>&1 &');
          
          exec(serveCommand, (error) => {
            if (error) {
              console.error('Ollama 자동 시작 실패:', error.message);
              status.autoStartFailed = true;
              resolve(status);
            } else {
              console.log('Ollama 시작 명령 실행됨, 3초 대기 중...');
              // 실행 후 3초 대기 후 상태 다시 확인
              setTimeout(async () => {
                status.running = await checkRunning();
                status.autoStartFailed = !status.running;
                console.log('Ollama 재확인 결과:', status.running ? '실행 중' : '실행 실패');
                resolve(status);
              }, 3000);
            }
          });
        } catch (startError) {
          console.error('Ollama 자동 시작 오류:', startError.message);
          status.autoStartFailed = true;
          resolve(status);
        }
      } else {
        // 이미 실행 중
        console.log('Ollama 이미 실행 중');
        resolve(status);
      }
    });
  });
}

// IPC 통신 설정
ipcMain.handle('save-file', async (event, { fileName, data }) => {
  console.log(`파일 저장 요청: ${fileName}`);
  try {
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: fileName,
      filters: [{ name: 'PowerPoint', extensions: ['pptx'] }]
    });
    
    if (canceled || !filePath) {
      console.log('파일 저장 취소됨');
      return { success: false };
    }
    
    fs.writeFileSync(filePath, Buffer.from(data));
    console.log(`파일 저장 성공: ${filePath}`);
    return { 
      success: true, 
      filePath: filePath,
      fileName: path.basename(filePath)
    };
  } catch (error) {
    console.error('파일 저장 오류:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('open-file', async (event, filePath) => {
  console.log(`파일 열기 요청: ${filePath}`);
  try {
    if (!fs.existsSync(filePath)) {
      console.error(`파일이 존재하지 않음: ${filePath}`);
      return { success: false, error: '파일이 존재하지 않습니다.' };
    }
    
    await shell.openPath(filePath);
    console.log(`파일 열기 성공: ${filePath}`);
    return { success: true };
  } catch (error) {
    console.error('파일 열기 오류:', error.message);
    return { success: false, error: error.message };
  }
});

// IPC 핸들러 추가
ipcMain.handle('check-ollama-status', async () => {
  console.log('Ollama 상태 확인 IPC 요청 받음');
  const status = await checkAndStartOllama();
  console.log('Ollama 상태 확인 결과:', status);
  return status;
});

// Ollama를 수동으로 실행하는 핸들러 (개선버전)
ipcMain.handle('start-ollama-manually', async () => {
  console.log('Ollama 수동 시작 요청됨');
  
  return new Promise((resolve) => {
    try {
      if (os.platform() === 'darwin') {
        // macOS에서는 PATH를 명시적으로 설정하여 실행
        const command = 'PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:$PATH ollama serve > /dev/null 2>&1 &';
        exec(command, (error) => {
          if (error) {
            console.error('Ollama 수동 시작 오류:', error.message);
            resolve({ success: false, error: error.message });
          } else {
            console.log('Ollama 수동 시작 성공');
            resolve({ success: true });
          }
        });
      } else if (os.platform() === 'win32') {
        // Windows에서는 숨겨진 창으로 실행
        exec('start /min cmd /c ollama serve', (error) => {
          resolve({ success: !error, error: error ? error.message : null });
        });
      } else {
        // 다른 플랫폼에서는 터미널 열기
        const terminal = 'x-terminal-emulator -e';
        exec(`${terminal} ollama serve`);
        resolve({ success: true });
      }
    } catch (error) {
      console.error('Ollama 수동 시작 예외:', error.message);
      resolve({ success: false, error: error.message });
    }
  });
});