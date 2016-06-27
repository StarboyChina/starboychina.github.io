---
layout: post
title: 基于 Centos7 搭建Kubernetes (1.2版)
fullview: true
categories: [分布式,Kubernetes]
tags: [Kubernetes, Centos7]
---

### 环境准备

本示例基本环境由1个 master,和1个 node 构成.

可以通过 vagrant 来快速搭建两个 centos7 环境.

Vagrantfile 如下

```Vagrantfile
Vagrant.configure("2") do |config|

  config.vm.box = "centos/7"

  config.vm.define "master" do | host |
    host.vm.hostname = "master"
    host.vm.network "private_network", ip: "192.168.8.8"
    host.vm.provider "virtualbox" do |v|
      v.memory = 1024
    end
  end

  config.vm.define "node" do | host |
    host.vm.hostname = "node"
    host.vm.network "private_network", ip: "192.168.8.9"
    host.vm.provider "virtualbox" do |v|
      v.memory = 2048
    end
  end
end
```

启动虚拟机

```shell
vagrant up

# 链接到 master
vagrant ssh master

# 链接到 node
vagrant ssh node
```

### 搭建 master

我们要使用 docker 来安装 master.

并且为了所有容器能够互通,我们采用 flannel 来构建网络.

本示例不需要在 master 上部署容器(不安装 kubelet 及 kube-proxy),所以不需要在 master 上安装 flannel.

只需要在 master 上安装 etcd 并配置 flannel 的属性.

在 master 上执行

```shell
# 安装 docker
sudo yum install docker -y

# 启动 docker
sudo systemctl enable docker
sudo systemctl start docker
sudo systemctl status docker

# 启动 etcd
sudo docker run -d -p 2379:2379 \
            --restart=always \
            --name etcd \
            quay.io/coreos/etcd:v2.3.7 \
            --advertise-client-urls http://0.0.0.0:2379 \
            --listen-client-urls http://0.0.0.0:2379 \
            --listen-peer-urls http://0.0.0.0:2380

# 启动 kube-apiserver
# ※ starboychina/kube-apiserver 的版本是 1.2.4
# 有条件的话可以使用官方镜像 gcr.io/google_containers/kube-apiserver:v1.2.4
# 或者下载 https://github.com/kubernetes/kubernetes/releases/download/v1.2.4/kubernetes.tar.gz
# 解压 kubernetes/server/kubernetes-server-linux-amd64.tar.gz
# 使用 docker load -i kubernetes/server/bin/kube-apiserver.tar
# 把镜像导入到本地
sudo docker run -d -p 8080:8080 \
            --restart=always \
            --name apiserver \
            --link etcd:etcd \
            starboychina/kube-apiserver \
            --v=2 \
            --etcd-servers=http://etcd:2379 \
            --insecure-bind-address=0.0.0.0 \
            --port=8080 \
            --kubelet-port=10250 \
            --allow-privileged=false \
            --service-cluster-ip-range=10.254.0.0/16  \
            --admission-control=NamespaceLifecycle,NamespaceExists,LimitRanger,SecurityContextDeny,ResourceQuota

# 启动 kube-controller-manager
# ※ starboychina/kube-controller-manager 的版本是 1.2.4
# 有条件的话可以使用官方镜像 gcr.io/google_containers/kube-controller-manager:v1.2.4
# 或者下载 https://github.com/kubernetes/kubernetes/releases/download/v1.2.4/kubernetes.tar.gz
# 解压 kubernetes/server/kubernetes-server-linux-amd64.tar.gz
# 使用 docker load -i kubernetes/server/bin/kube-controller-manager.tar
# 把镜像导入到本地
sudo docker run -d \
            --restart=always \
            --name controllermanager \
            --link apiserver:apiserver \
            starboychina/kube-controller-manager \
            --logtostderr=true \
            --master=http://apiserver:8080 \
            --v=2

# 启动 kube-scheduler
# ※ starboychina/kube-scheduler 的版本是 1.2.4
# 有条件的话可以使用官方镜像 gcr.io/google_containers/kube-scheduler:v1.2.4
# 或者下载 https://github.com/kubernetes/kubernetes/releases/download/v1.2.4/kubernetes.tar.gz
# 解压 kubernetes/server/kubernetes-server-linux-amd64.tar.gz
# 使用 docker load -i kubernetes/server/bin/kube-scheduler.tar
# 把镜像导入到本地
sudo docker run -d \
            --restart=always \
            --name scheduler \
            --link apiserver:apiserver \
            starboychina/kube-scheduler \
            --logtostderr=true \
            --master=http://apiserver:8080 \
            --v=2


# 配置 flannel 的属性
# /atomic.io/network 可以为任意值 后面启动 flannel 是需要用到
sudo docker exec etcd /etcdctl mk /atomic.io/network/config '{"Network":"172.17.0.0/16"}'

```

### 搭建 node

```shell
# 安装 flannel 和 kubernetes-node
sudo yum -y install flannel kubernetes-node -y

# master IP
master=192.168.8.8
# node IP
node=192.168.8.9

# 启动 flanneld
sudo flanneld -etcd-endpoints=http://${master}:2379 -etcd-prefix=/atomic.io/network &

#查看 /run/flannel/subnet.env
# 获取 FLANNEL_SUBNET
# 配置 docker 网络
sudo vi /etc/sysconfig/docker-network

# 修改为
DOCKER_NETWORK_OPTIONS="--bip=${FLANNEL_SUBNET} --ip-masq=true --mtu=1472"



# 启动 docker
sudo systemctl enable docker
sudo systemctl start docker
sudo systemctl status docker


# 启动 kube-proxy
sudo kube-proxy --logtostderr=true --v=0 --master=http://${master}:8080 &

# 启动 kubelet
sudo kubelet --v=2 --api-servers=http://${master}:8080 --address=0.0.0.0 --port=10250 --hostname-override=${node} --allow-privileged=false &

```

※ 如果 node 需要使用 systemctl 启动的话 请参照 上述启动命令来配置 service

※ service 配置文件的路径可通过 systemctl status kubelet 来查看

### 验证

```shell
# 在任意一台安装 docker 的环境下执行
# master IP
master=192.168.8.8:8080
# 开放端口的 node IP
node=192.168.8.9

# 查看 master
sudo docker run -it --rm starboychina/kubectl -s ${master} cluster-info

# 查看 node
sudo docker run -it --rm starboychina/kubectl -s ${master} get nodes


# 部署一个 Replica Set
sudo docker run -it --rm starboychina/kubectl -s ${master} run home --image=ebusinessdocker/home --replicas=2

# 查看部署的 Replica Set
sudo docker run -it --rm starboychina/kubectl -s ${master} get rs

# 部署一个 service (开放端口)
# 通过 http://${node}:8081 来访问 部署的 home
# home-2491572331 为 get rs 所查到的 rs 的 name
sudo docker run -it --rm starboychina/kubectl -s ${master} expose rs home-2491572331 --port 8081 --target-port=80 --external-ip="${node}"


# 删除 Replica Set
sudo docker run -it --rm starboychina/kubectl -s ${master} delete deployment/home

# 删除 Repservice
sudo docker run -it --rm starboychina/kubectl -s ${master} delete service/home-2491572331

```

到此完成了,通过 Kubernetes 部署 一台 master 一个 node 并且在 node 上启动2个 homepage 容器,并且可以通过指定 IP及端口 访问部署的 homepage

如果需要部署个 node 请重复 [搭建 node] 过程
