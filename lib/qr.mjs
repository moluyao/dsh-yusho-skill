// 二维码：终端里用方块字画，网页里出 SVG。内容是 yusho:pair?c=<6 位码>&k=<电脑的公钥>，手机扫了就知道连哪台、用哪个码
import QRCode from 'qrcode'
export const qrTerminal = (text) => QRCode.toString(text, { type: 'terminal', small: true, errorCorrectionLevel: 'M' })
export const qrSvg = (text) => QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#141A33', light: '#FFFFFF' } })
