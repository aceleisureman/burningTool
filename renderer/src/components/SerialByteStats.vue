<!-- 串口 Tx/Rx 字节计数：隔离 serial.tx/rx 订阅，高波特率下不拖动 App 主模板 -->
<script>
import { inject } from 'vue';
export default {
  name: 'SerialByteStats',
  setup() {
    const { serial } = inject('serial');
    return { serial };
  }
};
</script>
<template>
  <span>Tx {{ serial.tx }} 字节</span><span>Rx {{ serial.rx }} 字节</span>
</template>
